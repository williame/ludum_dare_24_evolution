var ws, game, messages;

var std_msg = {
	loading: 1,
	connecting: 2,
	disconnected: 3,
	hello: 4,
	no_players: 5,
	died: 6,
};

var grid, grid_program, grid_data, grid_tex,
	grid_sides = [[1,.5,.5],[.5,1,.5],[.5,.5,1],[1,1,.5],[.5,1,1],[1,.5,1]];
var player_models = [];
var died_splash;
var particle, particle_program;

var sounds = {
	winning: [],
	losing: [],
};

function randomSound(list) {
	if(list.length)
		playAudio(list[Math.floor(Math.random()*list.length)]);
}

var shots, shots_len = 0;

function gameHandler(evt) {
	var data = JSON.parse(evt.data);
	ws.last_message = now();
	var old_num_players = game? game.num_players: -1;
	if(data.updates) {
		game.tick = data.tick*game.tick_length;
		for(var update in data.updates) {
			update = data.updates[update];
			var player = game.players[update.name];
			if(update.pos) player.pos = update.pos;
			if(update.rot) player.rot = update.rot;
			if(update.speed) player.speed = update.speed;
		}
		var shots_data = [];
		for(var shot in data.shots) {
			shot = data.shots[shot];
			shots_data = shots_data.concat(shot.pos,[.25,.25],vec3_add(shot.pos,shot.vec),[.75,.75]);
		}
		if(shots_data.length) {
			gl.bindBuffer(gl.ARRAY_BUFFER,shots);
			gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(shots_data),gl.STATIC_DRAW);
		}
		shots_len = shots_data.length;
	}
	else if(data.pong) {
	} else if(data.chat) {
		for(var chat in data.chat)
			for(var player in data.chat[chat])
				addMessage(10,player,data.chat[chat][player]);
	} else if(data.welcome) {
		game.welcomed = true;
		game.player = data.welcome.name;
		game.tick_length = data.welcome.tick_length;
		game.start_time = now()-data.welcome.time_now;
		game.tick = data.welcome.time_now;
		removeMessage(std_msg.connecting);
		game.num_players = 0
		var other_players = "";
		for(var player in data.welcome.players) {
			game.num_players++;
			player = data.welcome.players[player];
			game.players[player.name] = {
				name:player.name,
				time:player.time,
				pos:player.pos,
				rot:player.rot,
				speed:player.speed,
				model:player_models[player.model],
			};
			for(var key in player.keys)
				game.players[player.name].keys[key] = true;
			if(player.name != game.player) {
				if(other_players.length) other_players += ", ";
				other_players += player.name;
			}
		}
		if(other_players.length)
			addMessage(6,null,"playing against: "+other_players);
	} else if(data.joining) {
		if(!(data.joining in game.players)) {
			game.num_players++;
			game.players[data.joining.name] = { 
				name:data.joining.name,
				time:data.joining.time,
				pos:data.joining.pos,
				rot:data.joining.rot,
				speed:data.joining.speed,
				model:player_models[data.joining.model],
			};
			addMessage(6,null,data.joining.name+" joins the game");
		}
	} else if(data.leaving) {
		if(data.leaving in game.players) {
			if(data.leaving == game.player) {
				if(data.killed_by) {
					addMessage(null,null,""+game.player+", you died, killed by "+data.killed_by+"!",std_msg.died);
					randomSound(sounds.losing);
					if(died_splash)
						died_splash.show();
				} else
					addMessage(null,null,""+game.player+" disconnected, "+data.reason,std_msg.died);
				ws.close();
				return;
			} else {
				game.num_players--;
				addMessage(6,null,data.leaving+" leaves the game: "+data.reason);
				if(data.killed_by == game.player)
					randomSound(sounds.winning);
				delete game.players[data.leaving];
			}
		}
	} else
		console.log("ERROR unhandled message",data);
	if(game && old_num_players != game.num_players) {
		if(game.num_players == 1) {
			addMessage(null,null,"Hello "+game.player,std_msg.hello);
			addMessage(null,null,"There are no other players!  Get a friend to play online NOW!",std_msg.no_players);
		} else {
			removeMessage(std_msg.no_players);
			if(game.num_players == 2) // poor plurals always annoy me
				addMessage(null,null,"Hello "+game.player+", there is 1 other player",std_msg.hello);
			else
				addMessage(null,null,"Hello "+game.player+", there are "+(game.num_players-1)+" other players",std_msg.hello);
		}
	}
}

function addMessage(secs,from,text,tag) {
	var 	f = from? UILabel(from): null,
		message = UIPanel(f?[f,UILabel(text)]:[UILabel(text)],true);
	message.bgColour = [0.2,0.2,0.2,1];
	message.tag = tag;
	if(f) f.fgColour = (game && from==game.player)?[0.8,0.8,1,1]: [0.8,1,0.8,1];
	var old = tag? getMessage(tag): null;
	if(old) {
		old.parent.replaceChild(old,message);
		if(old.dismisser) clearTimeout(old.dismisser);
	} else
		messages.ctrl.addChild(message);
	if(secs) message.dismisser = setTimeout(function() { message.destroy(); },secs*1000);
}

function getMessage(tag) {
	for(var message in messages.ctrl.children) {
		message = messages.ctrl.children[message];
		if(message.tag == tag)
			return message;
	}
	return null;
}

function removeMessage(tag) {
	var message = getMessage(tag);
	if(message) message.destroy();
	return message != null;
}

function newGame() {
	game = {
		welcomed:false,
		attitude:{ // this is for user feedback, not actually used to compute heading
			roll:0,
			pitch:0,
			yaw:0,
		},
		num_players:0,
		players:[],
	};
}

function getParameterByName(name) {
	name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
	var	regexS = "[\\?&]" + name + "=([^&#]*)",
		regex = new RegExp(regexS),
		results = regex.exec(window.location.search);
	if(results == null) return "";
	return decodeURIComponent(results[1].replace(/\+/g, " "));
}

function start() {
	removeMessage(std_msg.loading);
	removeMessage(std_msg.disconnected);
	addMessage(null,null,"connecting...",std_msg.connecting);
	var ws_path = getParameterByName("server");
	if(!ws_path) {
		if(ws_path.indexOf("localhost") != -1) // if running locally, connect locally
			ws_path = ws_path.split("/")[2];
		else
			ws_path = "31.192.226.244:4874"; // my private server; if you fork, you have to change this
	}
	ws_path = "ws://"+ws_path+"/ws-ld24";
	ws = new WebSocket(ws_path);
	ws.onopen = function() {
		console.log("websocket",ws_path,"open");
		ws.pinger = setInterval(ws.ping,1000);
		removeMessage(std_msg.died);
		if(died_splash)
			died_splash.hide();
	};
	ws.onclose = function() {
		console.log("websocket",ws_path,"closed");
		if(ws.pinger) clearInterval(ws.pinger);
		removeMessage(std_msg.hello);
		removeMessage(std_msg.no_players);
		addMessage(null,null,"disconnected!  press F5 or wait to connect!",std_msg.disconnected);
		newGame();
		setTimeout(start,3000); // location.reload doesn't work on Chrome/Safari
	};
	ws.error = function(e) {
		if(e && e.message) e = e.message;
		console.log("websocket",ws_path,"encountered an error:",e);
		addMessage(6,null,"encountered a network problem: "+e);
		ws.close();
	};
	ws.onerror = ws.error;
	ws.onmessage = function(evt) {
		try {
			gameHandler(evt);
		} catch(e) {
			console.log("WebSocket ERROR",e);
			ws.error(e);
		}
	};
	ws.ping = function() {
		if(ws.last_message < now()-2000)
			ws.error("ping failed");
		else
			ws.send(JSON.stringify({"ping":0}));
	};
}

function inited() {
	newGame();
	messages = UIWindow(false,UIPanel([],false,UILayoutRows));
	addMessage(null,null,"loading... please wait",std_msg.loading);
	messages.show();
	shots = gl.createBuffer();
	loadFile("image","grid.png",function(handle) {
		grid_tex = handle;
		gl.bindTexture(gl.TEXTURE_2D,handle);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
		gl.bindTexture(gl.TEXTURE_2D,null);
		initGrid(64);
	});
	loadFile("image","particle.png",function(handle) {
		particle = handle;
		gl.bindTexture(gl.TEXTURE_2D,handle);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
		gl.bindTexture(gl.TEXTURE_2D,null);
	});
	for(var i=0; i<8; i++)
		player_models.push(new G3D("fighter"+(i+1)+".g3d"));
	loadFile("image","splash_lose.jpg",function(handle) {
			died_splash = UIWindow(false,UIComponent()); // not shown yet
			died_splash.ctrl.draw = function(ctx) {
				var 	x1 = handle.width<ctx.width? -(handle.width/ctx.width)/2: 0,
					y1 = handle.height<ctx.height? -(handle.height/ctx.height)/2: 0,
					x2 = 1-x1,
					y2 = 1-y1;
				ctx.drawRect(handle,[1,1,1,1],0,0,ctx.width,ctx.height,x1,y1,x2,y2);
			};
	});
	particle_program = createProgram(
		"precision mediump float;\n"+
		"varying vec2 texel;\n"+
		"attribute vec3 vertex;\n"+
		"attribute vec2 texCoord;\n"+
		"uniform mat4 mvMatrix, pMatrix;\n"+
		"void main() {\n"+
		"	texel = vec2(texCoord.x,texCoord.y);\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
		"}\n",
		"precision mediump float;\n"+
		"varying vec2 texel;\n"+
		"uniform sampler2D texture;\n"+
		"uniform vec4 colour;\n"+
		"void main() {\n"+
		"	vec4 tex = texture2D(texture,texel) * colour;\n"+
		"	gl_FragColor = vec4(tex.rgb,tex.a);\n"+
		"}\n");
	particle_program.vertex = gl.getAttribLocation(particle_program,"vertex");
	particle_program.texCoord = gl.getAttribLocation(particle_program,"texCoord");
	particle_program.mvMatrix = gl.getUniformLocation(particle_program,"mvMatrix");
	particle_program.pMatrix = gl.getUniformLocation(particle_program,"pMatrix");
	particle_program.texture = gl.getUniformLocation(particle_program,"texture");
	particle_program.colour = gl.getUniformLocation(particle_program,"colour");
	if(audio) {
		loadFile("audio","voice_intro-darwin-quote.ogg",playAudio);
		loadFile("audio","sound_fire.ogg",function(sound) { sounds.fire = sound; });
		for(var i=0; i<6; i++)
			loadFile("audio","voice_winning_"+(i+1)+".ogg",function(sound) { sounds.winning.push(sound); });
		for(var i=0; i<8; i++)
			loadFile("audio","voice_losing"+(i+1)+".ogg",function(sound) { sounds.losing.push(sound); });
	} else
		addMessage(10,null,"sorry, your browser doesn't support the experimental Web Audio API, so there's no sounds");
}

function render() {
	if(!ws && !splash.dismissed) {
		var loaded = grid && particle;
		for(var model in player_models)
			if(!player_models[model].ready)
				loaded = false;
		if(loaded) splash.dismiss(start);
	}
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	if(!game) return;
	// draw it
	var	pMatrix = createPerspective(90.0,canvas.width/canvas.height,0.01,10),
		camMatrix = mat4_identity(),
		us = null;
	if(game.welcomed) {
		var thirdPerson = [0,-.02,-.04], t = 0;
		us = game.players[game.player];
		camMatrix = mat4_multiply(mat4_translation(vec3_neg(us.pos)),camMatrix);
		camMatrix = mat4_multiply(quat_to_mat4(us.rot),camMatrix);
		camMatrix = mat4_multiply(mat4_translation(thirdPerson),camMatrix);
	}
	if(grid) {
		gl.enable(gl.CULL_FACE);
		gl.frontFace(gl.CW);
		gl.useProgram(grid_program);
		gl.uniformMatrix4fv(grid_program.pMatrix,false,pMatrix);
		gl.uniformMatrix4fv(grid_program.mvMatrix,false,camMatrix);
		gl.uniformMatrix4fv(grid_program.nMatrix,false,mat4_inverse(mat4_transpose(camMatrix)));
		gl.uniform1i(grid_program.texture,0);
		gl.bindTexture(gl.TEXTURE_2D,grid_tex);
		gl.bindBuffer(gl.ARRAY_BUFFER,grid);
		gl.enableVertexAttribArray(grid_program.vertex);
		gl.vertexAttribPointer(grid_program.vertex,3,gl.FLOAT,false,4*(3+3+2),0);
		gl.enableVertexAttribArray(grid_program.normal);
		gl.vertexAttribPointer(grid_program.normal,3,gl.FLOAT,false,4*(3+3+2),4*3);
		gl.enableVertexAttribArray(grid_program.texCoord);
		gl.vertexAttribPointer(grid_program.texCoord,2,gl.FLOAT,false,4*(3+3+2),4*(3+3));
		for(var side=0; side<6; side++) {
			gl.uniform4f(grid_program.colour,grid_sides[side][0],grid_sides[side][1],grid_sides[side][2],1);
			gl.drawArrays(gl.TRIANGLES,side*6,6);
		}
		gl.disableVertexAttribArray(grid_program.texCoord);
		gl.disableVertexAttribArray(grid_program.normal);
		gl.disableVertexAttribArray(grid_program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.bindTexture(gl.TEXTURE_2D,null);
		gl.useProgram(null);
	}
	if(!game.welcomed) return;
	for(var player in game.players) {
		player = game.players[player];
		var mvMatrix = mat4_identity();
		mvMatrix = mat4_multiply(mat4_scale(0.004),mvMatrix);
		mvMatrix = mat4_multiply(quat_to_mat4(quat_inverse(player.rot)),mvMatrix);
		mvMatrix = mat4_multiply(mat4_translation(player.pos),mvMatrix);
		if(player.name == game.player) {
			// we show the player's pose so they feel like some feedback
			mvMatrix = mat4_multiply(mvMatrix,quat_to_mat4(quat_from_euler(game.attitude.roll,game.attitude.pitch,game.attitude.yaw*0.5)));
		}
		mvMatrix = mat4_multiply(camMatrix, mvMatrix);
		player.model.draw(0,pMatrix,mvMatrix,mat4_inverse(mat4_transpose(mvMatrix)));
	}
	if(shots_len) {
		gl.disable(gl.CULL_FACE);
		gl.useProgram(particle_program);
		gl.uniformMatrix4fv(particle_program.pMatrix,false,pMatrix);
		gl.uniformMatrix4fv(particle_program.mvMatrix,false,camMatrix);
		gl.uniform4f(particle_program.colour,0.7,0.7,1,1);
		gl.uniform1i(particle_program.texture,0);
		gl.bindTexture(gl.TEXTURE_2D,particle);
		gl.bindBuffer(gl.ARRAY_BUFFER,shots);
		gl.enableVertexAttribArray(particle_program.vertex);
		gl.vertexAttribPointer(particle_program.vertex,3,gl.FLOAT,false,4*(3+2),0);
		gl.enableVertexAttribArray(particle_program.texCoord);
		gl.vertexAttribPointer(particle_program.texCoord,2,gl.FLOAT,false,4*(3+2),4*3);
		gl.drawArrays(gl.LINES,0,shots_len/(3+2));
		gl.disableVertexAttribArray(particle_program.texCoord);
		gl.disableVertexAttribArray(particle_program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.bindTexture(gl.TEXTURE_2D,null);
		gl.useProgram(null);
	}
}

function initGrid(sz) {
	grid = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER,grid);
	var vertices = [
		// Front
		-1, -1,  1,	0,0,1,		0,  0,
		 1, -1,  1,	0,0,1,		sz, 0,
		 1,  1,  1,	0,0,1,		sz,sz,
		-1,  1,  1,	0,0,1,		0, sz,
		// Back
		-1, -1, -1,	0,0,-1,		0,  0,
		-1,  1, -1,	0,0,-1,		sz, 0,
		 1,  1, -1,	0,0,-1,		sz,sz,
		 1, -1, -1,	0,0,-1,		0, sz,
		// Top
		-1,  1, -1,	0,1,0,		0,  0,
		-1,  1,  1,	0,1,0,		sz, 0,
		 1,  1,  1,	0,1,0,		sz,sz,
		 1,  1, -1,	0,1,0,		0, sz,	 
		// Bottom
		-1, -1, -1,	0,-1,0,		0,  0,
		 1, -1, -1,	0,-1,0,		sz, 0,
		 1, -1,  1,	0,-1,0,		sz,sz,
		-1, -1,  1,	0,-1,0,		0, sz,
		// Right
		 1, -1, -1,	1,0,0,		0,  0,
		 1,  1, -1,	1,0,0,		sz, 0,
		 1,  1,  1,	1,0,0,		sz,sz,
		 1, -1,  1,	1,0,0,		0, sz,
		// Left
		-1, -1, -1,	-1,0,0,		0,  0, 
		-1, -1,  1,	-1,0,0,		sz, 0,
		-1,  1,  1,	-1,0,0,		sz,sz,
		-1,  1, -1,	-1,0,0,		0, sz, 
	], triangles = [
		0,  1,	2,	0,  2,	3,    // front
		4,  5,	6,	4,  6,	7,    // back
		8,  9,	10,	8,  10, 11,   // top
		12, 13, 14,	12, 14, 15,   // bottom
		16, 17, 18,	16, 18, 19,   // right
		20, 21, 22,	20, 22, 23    // left
	];
	grid_data = [];
	for(var vertex in triangles)
		for(var i=0; i<8; i++)
			grid_data.push(vertices[triangles[vertex]*8+i]);
	gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(grid_data),gl.STATIC_DRAW);
	if(!grid_program) {
		grid_program = createProgram(
			"precision mediump float;\n"+
			"varying vec3 lighting;\n"+
			"varying vec2 texel;\n"+
			"attribute vec3 vertex;\n"+
			"attribute vec3 normal;\n"+
			"attribute vec2 texCoord;\n"+
			"uniform mat4 mvMatrix, pMatrix, nMatrix;\n"+
			"void main() {\n"+
			"	texel = vec2(texCoord.x,texCoord.y);\n"+
			"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
			"	vec3 ambientLight = vec3(0.6,0.6,0.6);\n"+
			"	vec3 lightColour = vec3(0.8,0.9,0.75);\n"+
			"	vec3 lightDir = vec3(0.85,0.8,0.75);\n"+
			"	vec3 transformed = normalize(nMatrix * vec4(normal,1.0)).xyz;\n"+
			"	float directional = clamp(dot(transformed,lightDir),0.0,1.0);\n"+
			"	lighting = ambientLight + (lightColour*directional);\n"+
			"}\n",
			"precision mediump float;\n"+
			"varying vec3 lighting;\n"+
			"varying vec2 texel;\n"+
			"uniform sampler2D texture;\n"+
			"uniform vec4 colour;\n"+
			"void main() {\n"+
			"	vec4 tex = texture2D(texture,texel) * colour;\n"+
			"	gl_FragColor = vec4(tex.rgb*lighting,tex.a);\n"+
			"}\n");
		grid_program.vertex = gl.getAttribLocation(grid_program,"vertex");
		grid_program.normal = gl.getAttribLocation(grid_program,"normal");
		grid_program.texCoord = gl.getAttribLocation(grid_program,"texCoord");
		grid_program.mvMatrix = gl.getUniformLocation(grid_program,"mvMatrix");
		grid_program.pMatrix = gl.getUniformLocation(grid_program,"pMatrix");
		grid_program.nMatrix = gl.getUniformLocation(grid_program,"nMatrix");
		grid_program.texture = gl.getUniformLocation(grid_program,"texture");
		grid_program.colour = gl.getUniformLocation(grid_program,"colour");
	}
}

function onMouseDown(evt,keys) {} 

function onMouseUp(evt,keys) {}

function onKeyDown(evt,keys) {
	if(!ws || ws.readyState != 1) return;
	var feedback = Math.PI*Math.PI,
		key = evt.which, down = evt.type=="keydown";
	// if you are holding left and press right, they cancel out...
	if(key==37) { // left
		if(keys[39]) {
			key = 39; down = !down; feedback = -feedback;
		}
		game.attitude.yaw = down? -feedback: 0;
	} else if(key==39) { // right
		if(keys[37]) {
			key = 37; down = !down; feedback = -feedback;
		}
		game.attitude.yaw = down? feedback: 0;
	} else if(key==38) { // up
		if(keys[40]) {
			key = 40; down = !down; feedback = -feedback;
		}
		game.attitude.roll = down? feedback: 0;
	} else if(key==40) { // down
		if(keys[38]) {
			key = 38; down = !down; feedback = -feedback;
		}
		game.attitude.roll = down? -feedback: 0;
	} else if(key==65) { // A
		if(keys[68]) {
			key = 68; down = !down; feedback = -feedback;
		}
		game.attitude.yaw = down? -feedback: 0;
	} else if(key==68) { // D
		if(keys[65]) {
			key = 65; down = !down; feedback = -feedback;
		}
		game.attitude.yaw = down? feedback: 0;
	} else if(key==32) {
		if(down && sounds.fire)
			playAudio(sounds.fire);
	} else if(key!=83 && key!=87) { // W, S, [space]
		console.log("ignoring",evt.type,evt.which);
		return;
	}
	ws.send(JSON.stringify({
		key:{
			type:down?"keydown":"keyup",
			value:key,
		},
	}));
}

onKeyUp = onKeyDown;
