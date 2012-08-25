var ws, game, messages;

var g3d_player;

var grid, grid_program, grid_tex, grid_data;

function gameHandler(evt) {
	var data = JSON.parse(evt.data);
	if(data.welcome) {
		game.player = data.welcome.name;
		addMessage(3,null,"hello "+game.player);
		var other_players = "";
		for(var competitor in data.welcome.other_players) {
			competitor = data.welcome.other_players[competitor];
			if(other_players.length) other_players += ", ";
			other_players += competitor;
		}
		if(other_players.length)
			other_players = "playing against: "+other_players;
		else
			other_players = "There are no other players!  Get a friend to play NOW!";
		addMessage(5,null,other_players);
	}
	if(data.joining) {
		if(!(data.joining in game.competitors)) {
			game.competitors.push(data.joining);
			addMessage(3,null,data.joining+" joins the game");
		}
	}
	if(data.leaving) {
		var idx = game.competitors.indexOf(data.leaving);
		if(-1 != idx) {
			addMessage(3,null,data.leaving+" leaves the game");
			game.competitors.splice(idx,1);
		}
	}
}

function addMessage(secs,from,text) {
	var 	f = UILabel(from? from: "system"),
		message = UIPanel([f,UILabel(text)],true);
	message.bgColour = [0.2,0.2,0.2,1];
	f.fgColour = from==game.name?[0.8,0.8,1,1]: !from? [1,0.8,0.8,1]: [0.8,1,0.8,1];
	messages.tree.addChild(message);
	setTimeout(function() { message.destroy(); },secs*1000);
}

function inited() {
	messages = UIWindow(false,UIPanel([],false,UILayoutRows));
	messages.show();
	game = {
		pos:[0,0,0],
		competitors:[],
	};
	g3d_player = new G3D("fighter2.g3d");
	var ws_path = "ws://"+window.location.href.split("/")[2]+"/ws-ld24";
	ws = new WebSocket(ws_path);
	ws.onopen = function() {
		console.log("websocket",ws_path,"open");
	};
	ws.onclose = function() {
		console.log("websocket",ws_path,"closed");
		game = null;
	};
	ws.onerror = function(e) {
		console.log("websocket",ws_path,"encountered an error:",e);
		game = null;
		ws.close();
	};
	ws.onmessage = function(evt) {
		try {
			gameHandler(evt);
		} catch(e) {
			console.log(e);
			ws.onerror(e);
		}
	};
	loadFile("image","grid.png",function(handle) {
		grid_tex = handle;
		gl.bindTexture(gl.TEXTURE_2D,grid_tex);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
		gl.bindTexture(gl.TEXTURE_2D,null);
		grid = gl.createBuffer();
		initGrid(64);
	});
}

function render() {
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	if(!game) return;
	var	pMatrix = createPerspective(90.0,canvas.width/canvas.height,0.1,2),
		mvMatrix = mat4_translation(-game.pos[0],-game.pos[1],-game.pos[2]),
		nMatrix = mat4_inverse(mat4_transpose(mvMatrix));
	if(grid) {
		gl.enable(gl.CULL_FACE);
		gl.frontFace(gl.CW);
		gl.useProgram(grid_program);
		gl.uniformMatrix4fv(grid_program.pMatrix,false,pMatrix);
		gl.uniformMatrix4fv(grid_program.mvMatrix,false,mvMatrix);
		gl.uniformMatrix4fv(grid_program.nMatrix,false,nMatrix);
		gl.bindTexture(gl.TEXTURE_2D,grid_tex);
		gl.uniform1i(grid_program.texture,0);
		gl.bindBuffer(gl.ARRAY_BUFFER,grid);
		gl.enableVertexAttribArray(grid_program.vertex);
		gl.vertexAttribPointer(grid_program.vertex,3,gl.FLOAT,false,4*(3+3+2),0);
		gl.enableVertexAttribArray(grid_program.normal);
		gl.vertexAttribPointer(grid_program.normal,3,gl.FLOAT,false,4*(3+3+2),4*3);
		gl.enableVertexAttribArray(grid_program.texCoord);
		gl.vertexAttribPointer(grid_program.texCoord,2,gl.FLOAT,false,4*(3+3+2),4*(3+3));
		gl.drawArrays(gl.TRIANGLES,0,grid_data.length/8);
		gl.disableVertexAttribArray(grid_program.texCoord);
		gl.disableVertexAttribArray(grid_program.normal);
		gl.disableVertexAttribArray(grid_program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.useProgram(null);
	}
	mvMatrix = mat4_multiply(mvMatrix,mat4_translation(0,-0.1,-0.15));
	mvMatrix = mat4_multiply(mvMatrix,mat4_scale(0.02));
	g3d_player.draw((now()/1000)%1,pMatrix,mvMatrix,nMatrix);
}

function initGrid(sz) {
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
			"uniform float lerp;\n"+
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
			"uniform vec4 teamColour;\n"+
			"void main() {\n"+
			"	vec4 tex = texture2D(texture,texel);\n"+
			"	gl_FragColor = vec4(tex.rgb*lighting,tex.a);\n"+
			"}\n");
		grid_program.vertex = gl.getAttribLocation(grid_program,"vertex");
		grid_program.normal = gl.getAttribLocation(grid_program,"normal");
		grid_program.texCoord = gl.getAttribLocation(grid_program,"texCoord");
		grid_program.mvMatrix = gl.getUniformLocation(grid_program,"mvMatrix");
		grid_program.pMatrix = gl.getUniformLocation(grid_program,"pMatrix");
		grid_program.nMatrix = gl.getUniformLocation(grid_program,"nMatrix");
		grid_program.texture = gl.getUniformLocation(grid_program,"texture");
	}
}

function onMouseDown(evt,keys) {} 

function onMouseUp(evt,keys) {}

function onKeyDown(evt,keys) {
	if(evt.which == 37) { // left
		game.pos[0] += 0.1;
	} else if(evt.which == 38) { // up
		game.pos[1] += 0.1;
	} else if(evt.which == 39) { // right
		game.pos[0] -= 0.1;
	} else if(evt.which == 40) { // down
		game.pos[1] -= 0.1;
	}
}

function onKeyUp(evt,keys) {}

