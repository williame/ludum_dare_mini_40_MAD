
var	scene = {},
	startTime = now(),
	lastTick = 0,
	tickFps = 1,
	tickMillis = 1000/tickFps,
	ticks = 0,
	maxZoom = 80, minZoom = 20,
	zoom = 70,
	zoomFov, // computed in render step for smooth zooming
	lastZoom = zoom;
	
function onZoom(out) {
	if(out)
		zoom++;
	else
		zoom--;
	zoom = Math.min(maxZoom,Math.max(minZoom,zoom));
}

function onMouseDown(evt) {
	var	ray = unproject(evt.clientX,canvas.height-evt.clientY,scene.pMatrix,scene.mvMatrix,[0,0,canvas.width,canvas.height]),
		hit = sphere_ray_intersection2([0,0,0,1],ray[0],ray[1]);
	caret.setPos(hit);
}

function computeDistance(lng1,lat1,lng2,lat2) { // radians in, metres out.  untested
	return Math.acos(Math.sin(lat1)*Math.sin(lat2) + 
		Math.cos(lat1)*Math.cos(lat2) *
		Math.cos(lon2-lon1)) * 6370986;
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
	scene.sphere = Sphere(5);
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
	if(false) {
		scene.pMatrix = createPerspective(zoomFov,canvas.width/canvas.height,0.1,4);
		scene.eye = [0,0,-2];
		scene.mvMatrix = createLookAt(scene.eye,[0,0,0],[0,1,0]);
	} else {
		var	zoomFactor = 0.3+(zoomFov-minZoom)/(maxZoom-minZoom),
			xaspect = canvas.width>canvas.height? canvas.width/canvas.height: 1,
			yaspect = canvas.width<canvas.height? canvas.height/canvas.width: 1;
		scene.pMatrix = createOrtho2D(-zoomFactor*xaspect,zoomFactor*xaspect,-zoomFactor*yaspect,zoomFactor*yaspect);
		scene.mvMatrix = mat4_identity;
	}
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation((ticks+pathTime)/10,[0,1,0]));
	gl.clearColor(0,0,0,1);
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	//scene.sphere.draw(pMatrix,mvMatrix,[0,0,0,0.99]);
	scene.map.draw();
	caret.draw();
}

