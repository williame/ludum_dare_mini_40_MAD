
var	scene = {
		mvMatrix: mat4_identity,
	},
	startTime = now(),
	lastTick = 0,
	tickFps = 1,
	tickMillis = 1000/tickFps,
	ticks = 0,
	maxZoom = 80, minZoom = 20,
	zoom = 70,
	zoomFov, // computed in render step for smooth zooming
	lastZoom = zoom,
	pin = null,
	trajectories = [];
	
function onZoom(out) {
	if(out)
		zoom++;
	else
		zoom--;
	zoom = Math.min(maxZoom,Math.max(minZoom,zoom));
}

function evtPos(evt) {
	if(!scene.ortho) return null;
	var	x = lerp(scene.ortho[0],scene.ortho[1],evt.clientX/canvas.width),
		y = lerp(scene.ortho[3],scene.ortho[2],evt.clientY/canvas.height), // flipped
		sqrd = x*x+y*y;
	return (sqrd > 1)?
		null:
		mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[x,y,Math.sqrt(1-sqrd)]);
}

function onMouseDown(evt) {
	pin = evtPos(evt);
	if(pin && caret.pos) {
		trajectories.push(new Trajectory(caret.pos,pin));
		caret.setPos(pin);
	} else
		caret.setPos(pin);
}

function onMouseMove(evt,keys,isMouseDown) {
	if(!isMouseDown) return;
	return; //######
	var pt = evtPos(evt);
	if(pin == null) pin = pt;
	if(pt == null) return;
	var	d = vec3_sub(pt,pin),
		rotx = Math.atan2(d[1],d[2]),
		roty = (d[2] >= 0)||true?
			-Math.atan2(d[0] * Math.cos(rotx),d[2]):
			Math.atan2(d[0] * Math.cos(rotx),-d[2]),
		rotz = Math.atan2(Math.cos(rotx),Math.sin(rotx)*Math.sin(roty));
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(rotx,[1,0,0]));
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(roty,[0,1,0]));
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(rotz,[0,0,1]));
}

function onMouseUp(evt) {
	pin = null;
}

function Trajectory(from,to) {
	assert(this !== window);
	var	fromLL = vec3ToLngLat(from),
		toLL = vec3ToLngLat(to),
		dist = computeDistance(fromLL[0],fromLL[1],toLL[0],toLL[1]);
	this.steps = Math.max(10,Math.round(dist/100000)); // one every 100km for long journeys
	console.log("trajectory:",from,fromLL,to,toLL,dist,this.steps);
	var pts = new Float32Array(3*this.steps);
	from = vec3_vec4(from,0);
	to = vec3_vec4(to,0);
	for(var i=0; i<this.steps; i++) {
		var	t = i/(this.steps-1),
			pt = vec3_scale(quat_slerp(from,to,t),1+0.15*Math.sin(t*Math.PI));
		pts[i*3] = pt[0];
		pts[i*3+1] = pt[1];
		pts[i*3+2] = pt[2];
	}
	this.vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,pts,gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
}
Trajectory.prototype = {
	program: createProgram(
		"precision mediump float;\n"+
		"attribute vec3 vertex;\n"+
		"uniform mat4 pMatrix, mvMatrix;\n"+
		"void main() {\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
		"}\n",
		"precision mediump float;\n"+
		"uniform vec4 colour;\n"+
		"void main() {\n"+
		"	gl_FragColor = colour;\n"+
		"}\n",
		["pMatrix","mvMatrix","colour",],
		["vertex"]),
	draw: function() {
		gl.useProgram(this.program);
		gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
		gl.uniformMatrix4fv(this.program.pMatrix,false,scene.pMatrix);
		gl.uniformMatrix4fv(this.program.mvMatrix,false,scene.mvMatrix);
		gl.uniform4f(this.program.colour,1,0,0,1);
		gl.enableVertexAttribArray(this.program.vertex);
		gl.vertexAttribPointer(this.program.vertex,3,gl.FLOAT,false,3*4,0);
		gl.drawArrays(gl.LINE_STRIP,0,this.steps);
		gl.disableVertexAttribArray(this.program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.useProgram(null);
	},
};

function vec3ToLngLat(v) { // unit sphere point in, radians out
	return [Math.PI/2+Math.atan2(v[2],v[0]),Math.atan2(v[1],Math.sqrt(v[0]*v[0],v[2]*v[2]))];
}

function computeDistance(lng1,lat1,lng2,lat2) { // radians in, metres out.  untested
	return Math.acos(Math.sin(lat1)*Math.sin(lat2) + 
		Math.cos(lat1)*Math.cos(lat2) *
		Math.cos(lng2-lng1)) * 6370986;
}

function computeBearing(lng1,lat1,lng2,lat2) { // radians in and out.  untested
	var	y = Math.sin(lon2-lon1)*Math.cos(lat2),
		x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
	return Math.atan2(y,x);
}

var caret = { // this is just test code, to make it easy to put a marker anywhere on the globe, so we know where you clicked or whatever for debugging
	vbo: gl.createBuffer(),
	pos: null,
	dirty: true,
	setPos: function(pos) {
		this.pos = pos;
		this.dirty = pos;
	},
	draw: function() {
		if(!this.pos) return;
		gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
		if(this.dirty) {
			gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.pos),gl.STATIC_DRAW);
			this.dirty = false;
		}
		gl.useProgram(this.program);
		gl.uniformMatrix4fv(this.program.pMatrix,false,scene.pMatrix);
		gl.uniformMatrix4fv(this.program.mvMatrix,false,scene.mvMatrix);
		gl.uniform4f(this.program.colour,1,0,0,1);
		gl.uniform1f(this.program.pointSize,10);
		gl.enableVertexAttribArray(this.program.vertex);
		gl.vertexAttribPointer(this.program.vertex,3,gl.FLOAT,false,3*4,0);
		gl.drawArrays(gl.POINTS,0,1);
		gl.disableVertexAttribArray(this.program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.useProgram(null);
	},
	program: createProgram(
		"precision mediump float;\n"+
		"attribute vec3 vertex;\n"+
		"uniform mat4 pMatrix, mvMatrix;\n"+
		"uniform float pointSize;\n"+
		"void main() {\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
		"	gl_PointSize = pointSize;\n"+
		"}\n",
		"precision mediump float;\n"+
		"uniform vec4 colour;\n"+
		"void main() {\n"+
		"	gl_FragColor = colour;\n"+
		"}\n",
		["pMatrix","mvMatrix","colour","pointSize"],
		["vertex"]),
};		

function game() {
	splash.dismiss();
	loading = false;
	scene.map = {
		vbo: gl.createBuffer(),
		draw: function() {
			gl.useProgram(this.program);
			gl.uniformMatrix4fv(this.program.pMatrix,false,scene.pMatrix);
			gl.uniformMatrix4fv(this.program.mvMatrix,false,scene.mvMatrix);
			gl.uniform4f(this.program.fgColour,0,1,0,1);
			gl.uniform4f(this.program.bgColour,0,0.3,0,0.8);
			gl.enableVertexAttribArray(this.program.vertex);
			gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
			gl.lineWidth(1+3*(maxZoom-zoomFov)/(maxZoom-minZoom)); // scale lines by zoom
			gl.vertexAttribPointer(this.program.vertex,3,gl.FLOAT,false,3*4,0);
			var ofs = 0, parts = this.data.ofs;
			for(var part=0; part<parts.length; part++) {
				var start = ofs;
				ofs += parts[part];
				gl.drawArrays(gl.LINE_STRIP,start,ofs-start);
			}
			gl.disableVertexAttribArray(this.program.vertex);
			gl.bindBuffer(gl.ARRAY_BUFFER,null);
			gl.useProgram(null);
		},
		program: createProgram(
			"precision mediump float;\n"+
			"attribute vec3 vertex;\n"+
			"uniform mat4 pMatrix, mvMatrix;\n"+
			"varying vec4 v;\n"+
			"void main() {\n"+
			"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
			"	v = gl_Position;\n"+
			"}\n",
			"precision mediump float;\n"+
			"uniform vec4 fgColour, bgColour;\n"+
			"varying vec4 v;\n"+
			"void main() {\n"+
			"	gl_FragColor = (v.z > 0.0)? bgColour: fgColour;\n"+
			"}\n",
			["pMatrix","mvMatrix","fgColour","bgColour"],
			["vertex"]),
		data: getFile("json","data/world.json"),
	};
	var pts = [], deg2rad = Math.PI/180;
	for(var i=0; i<scene.map.data.pts.length; i+=2) {
		var	lng = scene.map.data.pts[i] * deg2rad,
			lat = scene.map.data.pts[i+1] * deg2rad;
		pts.push(-Math.cos(lat)*Math.cos(lng),Math.sin(lat),Math.cos(lat)*Math.sin(lng));
	}
	pts.push(0,0,0); // centre of sphere, for sprite z-culling trick
	gl.bindBuffer(gl.ARRAY_BUFFER,scene.map.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(pts),gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
}

function render() {
	var t = now()-startTime;
	if(t-lastTick > 1000) { // whole seconds elapsed?  eat them?
		console.log("eating",t-lastTick,"elapsed time");
		startTime = now();
		lastTick = t = ticks = 0;
	}
	// tick
	while(lastTick <= t) {
		//###....
		lastTick += tickMillis;
		ticks++;
		lastZoom = zoom;
	}
	var	gameTime = t,
		pathTime = Math.min(1,Math.max(0,1-((lastTick-t)/tickMillis))); // now as fraction of next step
	zoomFov = lastZoom+(zoom-lastZoom)*pathTime; // smooth zoom
	var	zoomFactor = 0.3+(zoomFov-minZoom)/(maxZoom-minZoom),
		xaspect = canvas.width>canvas.height? canvas.width/canvas.height: 1,
		yaspect = canvas.width<canvas.height? canvas.height/canvas.width: 1,
		ortho = [-zoomFactor*xaspect,zoomFactor*xaspect,-zoomFactor*yaspect,zoomFactor*yaspect];
	scene.ortho = ortho;
	scene.pMatrix = createOrtho2D(ortho[0],ortho[1],ortho[2],ortho[3],-2,2);
	//scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation((ticks+pathTime)/10,[0,1,0]));
	gl.clearColor(0,0,0,1);
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	scene.map.draw();
	for(var trajectory in trajectories)
		trajectories[trajectory].draw();
	caret.draw();
}

