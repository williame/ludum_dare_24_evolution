import os, subprocess, base64, json, traceback
from time import time as now
import tornado.ioloop
import tornado.websocket
import tornado.web
from tornado.options import define, options, parse_command_line

define("port",default=8888,type=int)
define("branch",default="master")
define("access",type=str,multiple=True)
define("local",type=bool)

class Game:
    def __init__(self):
        self.clients = set()
        self.seq = 1
    def add_client(self,client):
        client.name = "player%d"%self.seq
        self.seq += 1
        message = '{"joining":"%s"}'%client.name
        for competitor in self.clients:
            competitor.write_message(message)
        self.clients.add(client)
        client.write_message('{"welcome":{"name":"%s"}}'%client.name)
    def remove_client(self,client):
        if client in self.clients:
            self.clients.remove(client)
            message = '{"leaving":"%s"}'%client.name
            for competitor in self.clients:
                competitor.write_message(message)
    def chat(self,client,lines):
        messages = []
        for line in lines:
            assert isinstance(line,basestring)
            messages.append({client.name: line})
        messages = json.dumps({"chat":messages})
        for recipient in self.clients:
            recipient.write_message(messages)

class LD24WebSocket(tornado.websocket.WebSocketHandler):
    game = Game() # everyone in the same game for now
    def allow_draft76():
    	    print "draft76 rejected"
    	    return False
    def open(self):
        self.closed = False
        self.startTime = now()
        self.game.add_client(self)
    def on_message(self,message):
        self.lastMessage = now()
        try:
            message = json.loads(message)
            if "ping" in message:
                assert isinstance(message["ping"],int)
                self.write_message('{"pong":%d}'%message["ping"])
            if "chat" in message:
                assert isinstance(message["chat"],list)
                for line in message["chat"]:
                    assert isinstance(line,basestring)
                    self.game.chat(self,line)
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
