import os, subprocess, base64, json, traceback, time, math, random
import tornado.ioloop
import tornado.websocket
import tornado.web
from tornado.options import define, options, parse_command_line
import euclid

define("port",default=8888,type=int)
define("branch",default="master")
define("access",type=str,multiple=True)
define("local",type=bool)

num_models = 6

ticks_per_sec = 8
base_speed = .0015
base_max = .08
roll_speed = base_speed
max_roll_speed = base_max
pitch_speed = base_speed
max_pitch_speed = base_max
speed = base_speed
max_speed = base_max

class Game:
    def __init__(self):
        self.clients = set()
        self.tick_length = 1./ticks_per_sec
        self.ticker = tornado.ioloop.PeriodicCallback(self.run,1000/(ticks_per_sec*2))
    def now(self):
        return time.time()-self.start_time
    def add_client(self,client):
        if not self.clients:
            self.seq = 1
            self.start_time = time.time()
            self.tick = 0
            self.ticker.start()
        client.name = "player%d"%self.seq
        client.time = self.tick
        client.model = random.randint(0,num_models-1)
        self.seq += 1
        message = json.dumps({
            "joining":{
                "name":client.name,
                "model":client.model,
                "time":client.time,
                "pos":(client.pos.x,client.pos.y,client.pos.z),
                "rot":(client.rot.x,client.rot.y,client.rot.z,client.rot.w),
                "speed":client.speed,
            },
        })
        for competitor in self.clients:
            competitor.write_message(message)
        self.clients.add(client)
        message = {
            "welcome":{
                "name":client.name,
                "tick_length":1000/ticks_per_sec,
                "start_time":self.start_time*1000,
                "time_now":self.now()*1000,
                "players":[{
                    "name":c.name,
                    "model":c.model,
                    "time":c.time,
                    "pos":(c.pos.x,c.pos.y,c.pos.z),
                    "rot":(c.rot.x,c.rot.y,c.rot.z,c.rot.w),
                    "speed":c.speed,
                } for c in self.clients],
            },
        }
        client.write_message(json.dumps(message))
    def remove_client(self,client):
        if client in self.clients:
            self.clients.remove(client)
            message = '{"leaving":"%s"}'%client.name
            if not self.clients:
                self.ticker.stop() 
            else:
                for competitor in self.clients:
                    competitor.write_message(message)                
    def send_cmd(self,cmd):
        cmd["time"] = math.floor(self.now()*ticks_per_sec+1/ticks_per_sec)/ticks_per_sec*1000
        cmd = json.dumps({"cmd":cmd})
        for client in self.clients:
            client.write_message(cmd)
    def chat(self,client,lines):
        messages = []
        for line in lines:
            assert isinstance(line,basestring)
            messages.append({client.name: line})
        messages = json.dumps({"chat":messages})
        for recipient in self.clients:
            recipient.write_message(messages)
    def run(self):
        # time out old clients
        stale = time.time() - 3 # 3 secs
        for client in self.clients.copy():
            if client.lastMessage < stale:
                print "timing out",client.name,client.lastMessage-time.time()
                self.clients.remove(client)
                client.close()
        # move simulation onwards?
        while self.tick+self.tick_length <= self.now():
            updates = []
            for client in self.clients:
                # roll
                if 37 in client.keys: client.roll_speed += roll_speed
                if 39 in client.keys: client.roll_speed -= roll_speed
                client.roll_speed = max(-max_roll_speed,min(max_roll_speed,client.roll_speed))
                if 37 not in client.keys and 39 not in client.keys:
                    client.roll_speed *= .9
                if math.fabs(client.roll_speed) < 0.001: client.roll_speed = 0
                # pitch
                if 38 in client.keys: client.pitch_speed += pitch_speed
                if 40 in client.keys: client.pitch_speed -= pitch_speed
                client.pitch_speed = max(-max_pitch_speed,min(max_pitch_speed,client.pitch_speed))
                if 38 not in client.keys and 40 not in client.keys:
                    client.pitch_speed *= .9
                if math.fabs(client.pitch_speed) < 0.001: client.pitch_speed = 0
                # apply
                client.rot *= euclid.Quaternion().rotate_euler(0.,client.roll_speed,client.pitch_speed)
                client.rot.normalize()
                # speed
                if 83 in client.keys: client.speed -= speed
                if 87 in client.keys: client.speed += speed
                client.speed = max(0.,min(max_speed,client.speed)) # no going backwards
                if 83 not in client.keys and 87 not in client.keys:
                    client.speed *= .9
                if math.fabs(client.speed) < 0.001: client.speed = 0
                forward = euclid.Quaternion(0.,0.,0.,-1.)
                move = ((client.rot * forward) * client.rot.conjugated())
                move = euclid.Vector3(move.x,move.y,move.z).normalized() * client.speed
                client.pos += move
                # are we out-of-bounds?
                ### ideally bounce etc, but for now we'll just slide along it
                extreme = .85
                if client.pos.x < -extreme: client.pos.x = -extreme
                if client.pos.x >  extreme: client.pos.x =  extreme
                if client.pos.y < -extreme: client.pos.y = -extreme
                if client.pos.y >  extreme: client.pos.y =  extreme
                if client.pos.z < -extreme: client.pos.z = -extreme
                if client.pos.z >  extreme: client.pos.z =  extreme
                #print client.name, client.keys, client.roll_speed, client.pitch_speed, client.speed, client.rot, client.pos, move
                updates.append({
                    "name":client.name,
                    "pos":(client.pos.x,client.pos.y,client.pos.z),
                    "rot":(client.rot.x,client.rot.y,client.rot.z,client.rot.w),
                    "speed":client.speed,
                })
            for client in self.clients:
                client.write_message(json.dumps({
                        "tick":self.tick,
                        "updates":updates,
                }))
            self.tick += self.tick_length

class LD24WebSocket(tornado.websocket.WebSocketHandler):
    game = Game() # everyone in the same game for now
    def allow_draft76():
    	    print "draft76 rejected"
    	    return False
    def open(self):
        self.closed = False
        self.origin = self.request.headers.get("origin","")
        self.userAgent = self.request.headers.get("user-agent")
        print "connection",self.request.remote_ip, self.origin, self.userAgent
        if self.origin != "http://williame.github.com" and not \
            self.origin.startswith("http://31.192.226.244:") and not \
            self.origin.startswith("http://localhost:"):
            print "kicking out bad origin"
            self.write_message('{"chat":[{"Will":"if you fork the code, you need to run your own server!"}]}');
            self.close()
        self.lastMessage = time.time()
        self.keys = set()
        self.pos = euclid.Vector3(random.uniform(-.5,.5),random.uniform(-.5,.5),random.uniform(-.5,.5))
        self.rot = euclid.Quaternion() #.rotate_euler(random.uniform(-.5,.5),random.uniform(-.5,.5),random.uniform(-.5,.5)).normalized()
        self.speed = 0
        self.roll_speed = self.pitch_speed = 0
        self.game.add_client(self)
        print self.name,"joined;",len(self.game.clients),"players"
    def on_message(self,message):
        self.lastMessage = time.time()
        try:
            message = json.loads(message)
            assert isinstance(message,dict)
            if "ping" in message:
                assert isinstance(message["ping"],int)
                self.write_message('{"pong":%d}'%message["ping"])
            if "chat" in message:
                assert isinstance(message["chat"],list)
                for line in message["chat"]:
                    assert isinstance(line,basestring)
                    self.game.chat(self,line)
            if "key" in message:
                assert isinstance(message["key"],dict)
                assert isinstance(message["key"]["type"],basestring)
                assert message["key"]["type"] in ("keydown","keyup")
                assert isinstance(message["key"]["value"],int)
                assert message["key"]["value"] in (37,38,39,40,83,87)
                if message["key"]["type"] == "keydown":
                    self.keys.add(message["key"]["value"])
                else:
                    self.keys.discard(message["key"]["value"])
        except:
            print "ERROR processing",message
            traceback.print_exc()
            self.close()
    def write_message(self,msg):
        if self.closed: return
        try:
            tornado.websocket.WebSocketHandler.write_message(self,msg)
        except:
            print "ERROR sending join to",self.name
            traceback.print_exc()
            self.close()
    def on_close(self):
        if self.closed: return
        self.closed = True
        def do_close():
            self.game.remove_client(self)
            if hasattr(self,"name"):
                print self.name,"left;",len(self.game.clients),"players"
        io_loop.add_callback(do_close)


class MainHandler(tornado.web.RequestHandler):
    def get(self,path):
        # check user access
        auth_header = self.request.headers.get('Authorization') or ""
        authenticated = not len(options.access)
        if not authenticated and auth_header.startswith('Basic '):
            authenticated = base64.decodestring(auth_header[6:]) in options.access
        if not authenticated:
            self.set_status(401)
            self.set_header('WWW-Authenticate', 'Basic realm=Restricted')
            self._transforms = []
            self.finish()
            return
        # check not escaping chroot
        if os.path.commonprefix([os.path.abspath(path),os.getcwd()]) != os.getcwd():
            raise tornado.web.HTTPError(418)
        # get the file to serve
        body = None
        if options.local:
        	try:
        		with open(path,"r") as f:
        			body = f.read()
		except IOError:
			pass
	if not body:
		try:
		    body = subprocess.check_output(["git","show","%s:%s"%(options.branch,path)])
		except subprocess.CalledProcessError:
		    raise tornado.web.HTTPError(404)
        # and set its content-type
        self.set_header("Content-Type",subprocess.Popen(["file","-i","-b","-"],stdout=subprocess.PIPE,
            stdin=subprocess.PIPE, stderr=subprocess.STDOUT).communicate(input=body)[0].split(";")[0])
        # serve it
        self.write(body)
        

application = tornado.web.Application([
    (r"/ws-ld24", LD24WebSocket),
    (r"/(.*)", MainHandler),
])

if __name__ == "__main__":
    parse_command_line()
    application.listen(options.port)
    try:
        io_loop = tornado.ioloop.IOLoop.instance()
        io_loop.start()
    except KeyboardInterrupt:
        print "bye!"
