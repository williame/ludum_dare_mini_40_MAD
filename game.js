
var	scene = {},
	startTime = now(),
	lastTick = 0,
	tickFps = 1,
	tickMillis = 1000/tickFps,
	ticks = 0,
	maxZoom = 80, minZoom = 20,
	zoom = 60,
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
		hit = sphere_ray_intersects(vec3_vec4(mat4_vec3_multiply(mat4_multiply(scene.pMatrix,scene.mvMatrix),[0,0,0]),1),ray[0],ray[1]);
	caret.setPos(hit);
}

var caret = {
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
			var nMatrix = mat4_inverse(scene.mvMatrix);
			gl.uniformMatrix4fv(this.program.nMatrix,false,nMatrix);
			gl.uniform4fv(this.program.camera,mat4_vec4_multiply(mat4_inverse(scene.mvMatrix),[0,0,0,1]));
			gl.uniform4fv(this.program.colour,[0,1,0,1]);
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
			"uniform mat4 pMatrix, mvMatrix, nMatrix;\n"+
			"varying vec4 n;\n"+
			"void main() {\n"+
			"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
			"	n = nMatrix * vec4(vertex,1.0);\n"+
			"	gl_PointSize = 10.0;\n"+
			"}\n",
			"precision mediump float;\n"+
			"uniform vec4 colour;\n"+
			"uniform vec4 camera;\n"+
			"varying vec4 n;\n"+
			"void main() {\n"+
			"	if(dot(camera,n) < 0.0) discard;\n"+
			"	gl_FragColor = colour;\n"+
			"}\n",
			["pMatrix","mvMatrix","colour","camera","nMatrix"],
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
	scene.pMatrix = createPerspective(zoomFov,canvas.width/canvas.height,0.1,4);
	scene.eye = [-2,0,0];
	scene.mvMatrix = createLookAt(scene.eye,[0,0,0],[0,1,0]);
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation((ticks+pathTime)/10,[0,1,0]));
	gl.clearColor(0,0,0,1);
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	//scene.sphere.draw(pMatrix,mvMatrix,[0,0,0,0.99]);
	scene.map.draw();
	caret.draw();
}

