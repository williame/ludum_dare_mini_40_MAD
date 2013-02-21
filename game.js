
var	deg2rad = Math.PI/180,
	scene = {
		mvMatrix: mat4_identity,
	},
	startTime = now(),
	lastTick = 0,
	tickFps = 10,
	tickMillis = 1000/tickFps,
	ticks = 0,                                                
	maxZoom = 80, minZoom = 20,
	zoom = 70,
	zoomFov, // computed in render step for smooth zooming
	lastZoom = zoom,
	mouse = null,
	selected = null;

function onZoom(out) {
	zoom += out? 1: -1;
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
	var pos = evtPos(evt);
	if(!pos) return;
	if(selected && selected.attack) {
		selected.attack(pos);
		selected = null;
	} else {
		var nearest = null, nearest_dist;
		for(var site in scene.player.sites) {
			site = scene.player.sites[site];
			if(!site.fired) {
				var dist = computeDistance(site.pos,pos);
				if(nearest==null || dist<nearest_dist) {
					nearest = site;
					nearest_dist = dist;
				}
			}
		}
		if(nearest && nearest_dist < 100*1000) {
			selected = nearest;
		}
	}
}

function onMouseMove(evt,keys,isMouseDown) {
}

function onMouseUp(evt) {
}

function onKeyDown(evt) {
	if(evt.which==27 && selected) { //ESC
		selected = null;
	}
}

function Trajectory(from,to,colour) {
	assert(this !== window);
	this.distance = computeDistance(from,to);
	this.steps = Math.max(10,Math.round(this.distance/(50*1000))); // one every 50km for long journeys
	var pts = new Float32Array(3*this.steps);
	this.from = vec3_vec4(from,0);
	this.to = vec3_vec4(to,0);
	for(var i=0; i<this.steps; i++) {
		var	t = i/(this.steps-1),
			pt = this.getPos(t);
		pts[i*3] = pt[0];
		pts[i*3+1] = pt[1];
		pts[i*3+2] = pt[2];
	}
	this.vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,pts,gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
	this.colour = colour;
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
	getPos: function(t) {
		t = Math.max(Math.min(t,1),0);
		return vec3_scale(quat_slerp(this.from,this.to,t),1+0.15*Math.sin(t*Math.PI));
	},
	draw: function() {
		gl.useProgram(this.program);
		gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
		gl.uniformMatrix4fv(this.program.pMatrix,false,scene.pMatrix);
		gl.uniformMatrix4fv(this.program.mvMatrix,false,scene.mvMatrix);
		gl.uniform4fv(this.program.colour,this.colour||OPAQUE);
		gl.enableVertexAttribArray(this.program.vertex);
		gl.vertexAttribPointer(this.program.vertex,3,gl.FLOAT,false,3*4,0);
		gl.drawArrays(gl.LINE_STRIP,0,this.steps);
		gl.disableVertexAttribArray(this.program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.useProgram(null);
	},
};

function lngLatToVec3(lng,lat) {
	lng *= deg2rad;
	lat *= deg2rad;
	return [-Math.cos(lat)*Math.cos(lng),Math.sin(lat),Math.cos(lat)*Math.sin(lng)];
}

function vec3ToLngLat(v) { // unit sphere point in, radians out
	return [Math.PI/2+Math.atan2(v[2],v[0]),Math.atan2(v[1],Math.sqrt(v[0]*v[0],v[2]*v[2]))];
}

function computeDistance(from,to) { // radians in, metres out.  untested
	from = vec3ToLngLat(from);
	to = vec3ToLngLat(to);
	return Math.acos(Math.sin(from[1])*Math.sin(to[1]) + 
		Math.cos(from[1])*Math.cos(to[1]) *
		Math.cos(to[0]-from[0])) * 6370986;
}

function computeBearing(lng1,lat1,lng2,lat2) { // radians in and out.  untested
	var	y = Math.sin(lon2-lon1)*Math.cos(lat2),
		x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
	return Math.atan2(y,x);
}

function Sprite(tex,size,colour,pos) {
	assert(this !== window);
	this.vbo = gl.createBuffer();
	this.tex = tex;
	this.size = size || 10;
	this.colour = colour || OPAQUE;
	this.pos = pos;
	this.dirty = pos;
	if(tex && !getFile("image",tex))
		loadFile("image",tex);
}
Sprite.prototype = {
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
		gl.disable(gl.DEPTH_TEST);
		gl.useProgram(this.program);
		gl.uniformMatrix4fv(this.program.pMatrix,false,scene.pMatrix);
		gl.uniformMatrix4fv(this.program.mvMatrix,false,scene.mvMatrix);
		var tex = this.tex? getFile("image",this.tex): null;
		gl.bindTexture(gl.TEXTURE_2D,tex||programs.blankTex);
		gl.uniform4fv(this.program.colour,this.colour);
		gl.uniform1f(this.program.pointSize,this.size);
		gl.enableVertexAttribArray(this.program.vertex);
		gl.vertexAttribPointer(this.program.vertex,3,gl.FLOAT,false,3*4,0);
		gl.drawArrays(gl.POINTS,0,1);
		gl.disableVertexAttribArray(this.program.vertex);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.useProgram(null);
		gl.enable(gl.DEPTH_TEST);
	},
	program: createProgram(
		"precision mediump float;\n"+
		"attribute vec3 vertex;\n"+
		"uniform mat4 pMatrix, mvMatrix;\n"+
		"uniform float pointSize;\n"+
		"varying vec3 pos;\n"+
		"void main() {\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(vertex,1.0);\n"+
		"	pos = gl_Position.xyz/gl_Position.w;\n"+
		"	gl_PointSize = pointSize;\n"+
		"}\n",
		"precision mediump float;\n"+
		"uniform sampler2D texture;\n"+ 
		"uniform vec4 colour;\n"+
		"varying vec3 pos;\n"+
		"void main() {\n"+
		"	if(pos.z > 0.0) \n"+	
		"		discard;\n"+
		"	gl_FragColor = texture2D(texture,gl_PointCoord) * colour;\n"+
		"}\n",
		["pMatrix","mvMatrix","colour","pointSize"],
		["vertex"]),
};

function ICBMSite(country,name,pos) {
	Sprite.call(this,"data/base_icbm.png",36);
	this.country = country;
	this.name = name;
	this.setPos(pos);
	this.fired = false;
	this.explosion = 0;
	this.exploding = false;
	this.exploded = false;
	this.range = 0;
	this.yield = 20;
	this.missile = null;
	this.trajectory = null;
}
ICBMSite.prototype = {
	__proto__: Sprite.prototype,
	attack: function(dest) {
		assert(!this.fired);
		this.fired = lastTick+tickMillis; // start next tick
		this.range = 1;
		this.trajectory = new Trajectory(this.pos,dest,this.country.colours.flight_icbm);
		this.tex = "data/base_empty.png";
		this.missile = new Sprite("data/flight_icbm.png",36,this.country.colours.flight_icbm);
		if(!getFile("image",this.tex))
			loadFile("image",this.tex);
	},
	getPos: function() {
		if(this.fired)
			return this.trajectory.getPos(this.getTime());
		return pos;
	},
	getTime: function() {
		return Math.min(this.range,((now()-startTime)-this.fired) / (this.trajectory.distance/100));
	},
	draw: function(t) {
		this.colour = (this===selected)? [1,1,1,1]: this.country.colours.base_icbm;
		Sprite.prototype.draw.call(this);
		if(this.exploded)
			return;
		if(this.fired) {
			var pos = this.getPos();
			this.trajectory.draw();
			this.missile.setPos(pos);
			this.missile.draw();
			if(this.explosion) {
				Sphere(1).draw(scene.pMatrix,scene.mvMatrix,vec3_vec4(pos,(this.explosion+t)/300),this.country.colours.base_icbm,false,gl.LINES);
			}
		}
	},
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
			gl.uniform4fv(this.program.fgColour,scene.player.colours.map_fg);
			gl.uniform4fv(this.program.bgColour,scene.player.colours.map_bg);
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
	var pts = [];
	for(var i=0; i<scene.map.data.pts.length; i+=2) {
		var pos = lngLatToVec3(scene.map.data.pts[i],scene.map.data.pts[i+1]);
		pts.push(pos[0],pos[1],pos[2]);
	}
	pts.push(0,0,0); // centre of sphere, for sprite z-culling trick
	gl.bindBuffer(gl.ARRAY_BUFFER,scene.map.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(pts),gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
	
	scene.countries = getFile("json","data/sites.json").countries;
	for(var country in scene.countries) {
		country = scene.countries[country];
		country.sites = [];
		for(var site in country.base_icbm) {
			site = country.base_icbm[site];
			country.sites.push(new ICBMSite(country,site[0],lngLatToVec3(site[2],site[1])));
		}
	}
	loadFile("image","data/base_icbm.png");
	loadFile("image","data/base_empty.png");
	loadFile("image","data/flight_icbm.png");

	// start by hardcoding player to US
	scene.player = scene.countries.US;
	scene.mvMatrix = mat4_rotation(Math.PI,[0,1,0]);
	scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(0.45,[1,0,0]));
}

function render() {
	var t = now()-startTime;
	if(t-lastTick > 1000) { // whole seconds elapsed?  eat them?
		console.log("eating",(t-lastTick)/1000,"seconds elapsed time");
		for(var country in scene.countries) {
			country = scene.countries[country];
			for(var site in country.sites) {
				site = country.sites[site];
				if(site.fired && !site.exploding && !site.exploded) {
					site.fired -= lastTick;
				}
			}
		}
		startTime = now();
		lastTick = t = ticks = 0;
	}
	// tick
	while(lastTick <= t) {
		if(mousePos) {
			var	scrollEdge = 10,
				zoomT = 0.1 * Math.max(0.1,(zoom-minZoom)/(maxZoom-minZoom));
			if((keys[37] && !keys[39]) || mousePos[0] < scrollEdge) // left
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[0,-1,0])));
			else if((keys[39] && !keys[37]) || mousePos[0] > canvas.width-scrollEdge) // right
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[0,1,0])));
			if((keys[38] && !keys[40]) || mousePos[1] < scrollEdge) // up
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[-1,0,0])));
			else if((keys[40] && !keys[38]) || mousePos[1] > canvas.height-scrollEdge) // down
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[1,0,0])));
			if(keys[33] && !keys[34]) // pgup
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[0,0,-1])));
			else if(keys[34] && !keys[33]) // pgdn
				scene.mvMatrix = mat4_multiply(scene.mvMatrix,mat4_rotation(zoomT,mat4_vec3_multiply(mat4_inverse(scene.mvMatrix),[0,0,1])));
		}
		
		for(var country in scene.countries) {
			country = scene.countries[country];
			for(var site in country.sites) {
				site = country.sites[site];
				if(site.fired && !site.exploded) {
					if(site.explosion == site.yield) {
						site.exploding = false;
						site.exploded = true;
					} else if(site.exploding) {
						site.explosion++;
					} else {
						site.exploding = (site.getTime() == site.range);
					}
				}
			}
		}
		
		aiTick();
		
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
	for(var country in scene.countries) {
		country = scene.countries[country];
		for(var site in country.sites) {
			site = country.sites[site];
			site.draw(pathTime);
		}
	}
}

function aiTick() {
	// fire a random missile every 5 seconds; couldn't be stupider
	if(ticks && !(ticks%(5*tickFps))) {
		for(var country in scene.countries) {
			country = scene.countries[country];
			if(country == scene.player) continue;
			for(var site in country.sites) {
				site = country.sites[site];
				if(!site.fired) {
					var target = scene.player.sites[Math.floor(Math.random()*scene.player.sites.length)];
					site.attack(target.pos);
					break;
				}
			}
		}
	}
}

