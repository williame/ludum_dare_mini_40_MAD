function UIFont(xml,texture) {
	assert(this !== window);
	var	get = function (node,attr) { return parseInt(node.getAttribute(attr)); },
		common = xml.getElementsByTagName("common")[0];
	this.lineHeight = get(common,"lineHeight");
	this.base = get(common,"base");
	this.scaleW = get(common,"scaleW");
	this.scaleH = get(common,"scaleH");
	this.chars = [];
	var chars = xml.getElementsByTagName("char");
	for(var i=0; i<chars.length; i++) {
		var ch = chars[i];
		this.chars[get(ch,"id")] = {
			x: get(ch,"x"),
			y: get(ch,"y"),
			w: get(ch,"width"),
			h: get(ch,"height"),
			xofs: get(ch,"xoffset"),
			yofs: get(ch,"yoffset"),
			xadv: get(ch,"xadvance"),
		};
	}
	this.kernings = [];
	var kernings = xml.getElementsByTagName("kerning");
	for(var i=0; i<kernings.length; i++) {
		var kerning = kernings[i], first = get(kerning,"first");
		this.kernings[first] = this.kernings[first] || [];
		this.kernings[first][get(kerning,"second")] = get(kerning,"amount");
	}
	this.texture = texture;
}
UIFont.prototype = {
	measureText: function(text) {
		var prev = 13, x = 0, w = 0, y = this.lineHeight;
		for(var ch in text) {
			ch = text.charCodeAt(ch);
			if(ch == 10) {
				w = x;
				x = 0;
				y += this.lineHeight;
			} else if(ch in this.chars)
				x += this.chars[ch].xadv;
			if(prev in this.kernings)
				x += this.kernings[prev][ch] || 0;
			prev = ch;
		}
		return [Math.max(x,w),y];
	},
	drawText: function(ctx,colour,x,y,text) {
		var prev = 0, left = x;
		for(var ch in text) {
			ch = text.charCodeAt(ch);
			if(ch == 10) {
				x = left;
				y += this.lineHeight;
			} else if(ch in this.chars) {
				var data = this.chars[ch];
				ctx.drawRect(this.texture,colour,
					x+data.xofs,
					y+data.yofs,
					x+data.xofs+data.w,
					y+data.yofs+data.h,
					data.x/this.scaleW,
					data.y/this.scaleH,
					(data.x+data.w)/this.scaleW,
					(data.y+data.h)/this.scaleH);
				x += data.xadv;
			}
			if(prev in this.kernings)
				x += this.kernings[prev][ch] || 0;
			prev = ch;
		}
		return [x,y];
	},
};

function UIContext() {
	assert(this!==window);
	this.width = this.height = 0;
	this.buffers = [];
	this.data = [];
	this.vbo = null;
	this.corners = [];
	this._transforms = [];
	this.drawCount = 0;
	if(!UIContext.program)
		UIContext.program = createProgram(
			"uniform mat4 mvp;\n"+
			"uniform float z;\n"+
			"attribute vec2 vertex;\n"+
			"attribute vec2 texcoord;\n"+
			"varying vec2 tx;\n"+
			"void main() {\n"+
			"	tx = texcoord;\n"+
			"	gl_Position = mvp * vec4(vertex,z,1.0);\n"+
			"}",
			"precision mediump float;\n"+
			"uniform vec4 colour;\n"+
			"varying vec2 tx;\n"+
			"uniform sampler2D texture;\n"+
			"void main() {\n"+
			"	vec4 c = texture2D(texture,tx);\n"+
			"	gl_FragColor = colour * c;\n"+
			"}",["mvp","colour","z","texture"],["vertex","texcoord"]);
};
UIContext.corners = {};
UIContext.prototype = {
	clear: function() {
		this.data = [];
		this.buffers = [];
	},
	isEmpty: function() {
		return this.buffers.length == 0;
	},
	finish: function() {
		if(!this.vbo) this.vbo = gl.createBuffer();
		if(this.data.length) {
			gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
			gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.data),gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER,null);
		}
		this.data = this.data.length; // better to make it crash
		this.drawCount = 0;
	},
	inject: function(callback) {
		if(this.buffers.length)
			this.buffers[this.buffers.length-1].stop = this.data.length;
		this.buffers.push({
			inject: callback,
			injectArgs: Array.prototype.slice.call(arguments,1),
			texture: "invalid",
			start: this.data.length,
			stop: -1,
		});
	},
	transform: function(callback) { // give it a callback that gets called at each draw to modify the mvp matrix
		if(this.buffers.length)
			this.buffers[this.buffers.length-1].stop = this.data.length;
		this.buffers.push({
			transform: callback,
			transformArgs: arguments.length>1? Array.prototype.slice.call(arguments,1): null,
			texture: "invalid",
			start: this.data.length,
			stop: -1,
		});
	},
	pushTransform: function(mvp) {
		this.transform(this._pushTransform,mvp);
	},
	popTransform: function() {
		this.transform(this._popTransform);
	},
	_pushTransform: function(a,b) {
		this._transforms.push(a);
		return mat4_multiply(a,b);
	},
	_popTransform: function() {
		return this._transforms.pop();
	},
	set: function(texture,colour,mode) {
		if(this.buffers.length) {
			var buffer = this.buffers[this.buffers.length-1];
			if(buffer.texture == texture && buffer.colour == colour && buffer.mode == mode)
				return;
			buffer.stop = this.data.length;
		}
		this.buffers.push({
			texture: texture,
			colour: colour,
			transform: null,
			mode: mode,
			start: this.data.length,
			stop: -1, // marker to say until end of buffer
		});
	},
	drawText: function(font,colour,x,y,text) { return font? font.drawText(this,colour,x,y,text): 0; },
	drawTextOutlined: function(font,fgColour,outlineColour,x,y,text) {
		this.drawText(font,outlineColour,x,y,text);
		this.drawText(font,outlineColour,x,y,text);
		this.drawText(font,outlineColour,x+2,y+2,text);
		this.drawText(font,outlineColour,x+2,y+2,text);
		return this.drawText(font,fgColour,x+1,y+1,text)+1;
	},
	measureText: function(font,text) { return font? font.measureText(text): [0,0]; },
	drawRect: function(texture,colour,x1,y1,x2,y2,tx1,ty1,tx2,ty2) {
		this.set(texture,colour,gl.TRIANGLES);
		this.data = this.data.concat([
			x1,y2,tx1,ty2, x2,y1,tx2,ty1, x1,y1,tx1,ty1, //CCW
			x2,y2,tx2,ty2, x2,y1,tx2,ty1, x1,y2,tx1,ty2]);
	},
	fillRect: function(colour,x1,y1,x2,y2) {
		this.drawRect(programs.blankTex,colour,x1,y1,x2,y2,0,0,1,1);
	},
	drawLine: function(colour,x1,y1,x2,y2,width) {
		if(!width) {
			this.set(programs.blankTex,colour,gl.LINES);
			this.data = this.data.concat([x1,y1,0,0,x2,y2,1,1]);
		} else {
			this.set(programs.blankTex,colour,gl.TRIANGLES);
			var	angle = Math.atan2(y2 - y1, x2 - x1),
				cos = width/2 * Math.cos(angle),
				sin = width/2 * Math.sin(angle);
			this.data = this.data.concat([
			    x1 + sin, y1 - cos, 1, 0,
			    x2 + sin, y2 - cos, 1, 0,
			    x2 - sin, y2 + cos, 0, 1,
			    x2 - sin, y2 + cos, 0, 1,
			    x1 - sin, y1 + cos, 0, 1,
			    x1 + sin, y1 - cos, 1, 0,
			]);
		}
		return this;
	},
	drawBox: function(colour,x1,y1,x2,y2) {
		this.	drawLine(colour,x1,y1,x2,y1).
			drawLine(colour,x1,y2,x2,y2).
			drawLine(colour,x1,y1,x1,y2).
			drawLine(colour,x2,y1,x2,y2);
	},
	fillCircle: function(colour,x1,y1,radius) {
		this.fillRoundedRect(colour,radius,x1,y1,x1,y1);
	},
	_makeCorners: function(r) {
		var pts = [],
			x = r, y = 0,
			theta = 2 * Math.PI / (r*4),
			cos = Math.cos(theta), sin = Math.sin(theta);
		for(var i=0; i<r; i++) {
			var px = x, py = y;
			x = cos * x - sin * y;
			y = sin * px + cos * y;
			pts.push([px,py,x,y]);
		}
		return pts;
	},
	fillRoundedRect: function(colour,margin,x1,y1,x2,y2) {
		var	corner = UIContext.corners[margin] = UIContext.corners[margin] || this._makeCorners(margin),
			pts = [],
			addPoint = this._fillRoundedRect_addPoint,
			drawRect = this.drawRect;
		for(var pt in corner) {
			pt = corner[pt];
			addPoint(pts,pt,x1,-1,y1,-1);
			addPoint(pts,pt,x2,+1,y1,-1);
			addPoint(pts,pt,x1,-1,y2,+1);
			addPoint(pts,pt,x2,+1,y2,+1);
		}
		drawRect.call(this,programs.blankTex,colour,x1,y1-margin,x2,y2+margin,0,0,1,1); // sets up right texture and colour buffer
		drawRect.call(this,programs.blankTex,colour,x1-margin,y1,x1,y2,0,0,1,1);
		drawRect.call(this,programs.blankTex,colour,x2,y1,x2+margin,y2,0,0,1,1);
		this.data = this.data.concat(pts);
	},
	_fillRoundedRect_addPoint: function(pts,pt,x,xdir,y,ydir) {
		pts.push(
			x + xdir*pt[0], y + ydir*pt[1],
			0, 0,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x, y,
			1, 1
		);
	},
	drawRoundedRect: function(colour,margin,width,x1,y1,x2,y2) {
		var corner = UIContext.corners[margin] = UIContext.corners[margin] || this._makeCorners(margin),
			pts = [],
			scale = 1.0 - width/margin,
			addPoint = this._drawRoundedRect_addPoint,
			drawRect = this.drawRect;
		for(var pt in corner) {
			pt = corner[pt];
			addPoint(pts,scale,pt,x1,-1,y1,-1);
			addPoint(pts,scale,pt,x2,+1,y1,-1);
			addPoint(pts,scale,pt,x1,-1,y2,+1);
			addPoint(pts,scale,pt,x2,+1,y2,+1);
		}
		drawRect.call(programs.blankTex,colour,x1,y1-margin,x2,y1-margin+width,0,0,1,1); // sets up right texture and colour buffer
		drawRect.call(programs.blankTex,colour,x1,y2+margin-width,x2,y2+margin,0,0,1,1);
		drawRect.call(programs.blankTex,colour,x1-margin,y1,x1-margin+width,y2,0,0,1,1);
		drawRect.call(programs.blankTex,colour,x2+margin-width,y1,x2+margin,y2,0,0,1,1);
		this.data = this.data.concat(pts);
	},
	_drawRoundedRect_addPoint: function(pts,scale,pt,x,xdir,y,ydir) {
		pts.push(
			x + xdir*pt[0], y + ydir*pt[1],
			0, 0,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x + xdir*pt[0]*scale, y + ydir*pt[1]*scale,
			1, 1,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x + xdir*pt[0]*scale, y + ydir*pt[1]*scale,
			1, 1,
			x + xdir*pt[2]*scale, y + ydir*pt[3]*scale,
			1, 1
		);
	},
	_initShader: function(mvp,program) {
		gl.useProgram(program);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.DEPTH_TEST);
		gl.uniformMatrix4fv(program.mvp,false,mvp);
		gl.uniform1i(program.texture,0);
		gl.uniform1i(program.z,0.6);
		gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
		gl.activeTexture(gl.TEXTURE0);
		gl.enableVertexAttribArray(program.vertex);
		gl.enableVertexAttribArray(program.texcoord);
	},
	_deinitShader: function(program) {
		gl.disableVertexAttribArray(program.vertex);
		gl.disableVertexAttribArray(program.texcoord);
		gl.bindTexture(gl.TEXTURE_2D,null);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.useProgram(null);
	},
	draw: function(mvp,program,colour) {
		program = program || UIContext.program;
		this.drawCount++;
		var inited = false;
		for(var buffer in this.buffers) {
			buffer = this.buffers[buffer];
			if(buffer.inject) {
				this._deinitShader(program);
				inited = false;
				buffer.inject.apply(this,buffer.injectArgs);
				continue;
			} else if(buffer.transform) {
				mvp = buffer.transformArgs?
					buffer.transform.apply(this,[mvp].concat(buffer.transformArgs)):
					buffer.transform.call(this,mvp);
				if(inited)
					gl.uniformMatrix4fv(program.mvp,false,mvp);
				continue;
			}
			var len = (buffer.stop >= 0? buffer.stop: this.data)-buffer.start;
			if(!len) continue;
			if(!inited) {
				this._initShader(mvp,program);
				inited = true;
			}
			gl.bindTexture(gl.TEXTURE_2D,buffer.texture);
			if(colour)
				gl.uniform4fv(program.colour,[buffer.colour[0]*colour[0],buffer.colour[1]*colour[1],buffer.colour[2]*colour[2],buffer.colour[3]*colour[3]]);
			else
				gl.uniform4fv(program.colour,buffer.colour);
			gl.vertexAttribPointer(program.vertex,2,gl.FLOAT,false,16,0);
			gl.vertexAttribPointer(program.texcoord,2,gl.FLOAT,false,16,8);
			gl.drawArrays(buffer.mode,buffer.start/4,len/4);
		}
		if(inited)
			this._deinitShader(program);
	},
};

function UIWindow(modal,ctrl,tag) {
	assert(this !== window);
	this.mvp = null;
	this.isDirty = true;
	this.needsLayout = true;
	this.showScheduled = false;
	this.hideScheduled = false;
	this.modal = modal;
	this.ctrl = null;
	this.ctx = new UIContext();
	this.id = UI.windowIdSeq++; // for debug info
	this.tag = tag;
	this.setCtrl(ctrl);
};
UIWindow.prototype = {
	dirty: function() { this.isDirty = true; },
	draw: function(canvas) {
		if(this.ctx.width != canvas.offsetWidth || this.ctx.height != canvas.offsetHeight || !this.mvp) {
			this.ctx.width = canvas.offsetWidth;
			this.ctx.height = canvas.offsetHeight;
			this.isDirty = true;
			this.mvp = new Float32Array(createOrtho2D(0,this.ctx.width,this.ctx.height,0));
		}
		if(this.needsLayout)
			this.performLayout();
		if(this.isDirty) {
			this.ctx.clear();
			if(this.modal)
				this.ctx.fillRect(UI.defaults.modalClear,0,0,this.ctx.width,this.ctx.height);
			this.isDirty = false;
			this.walk(this._draw);
			this.ctx.finish();
		}
		this.ctx.draw(this.mvp);
	},
	_draw: function(ctrl) {
		if(!ctrl.visible)
			return false;
		ctrl.isDirty = false;
		ctrl.draw(this.ctx);
		return true;
	},
	walk: function(cb,ctrl) {
		ctrl = ctrl || this.ctrl;
		if(!ctrl) return;
		if(cb.call(this,ctrl)) {
			for(var child in ctrl.children) {
				child = ctrl.children[child];
				if(child)
					this.walk(cb,child);
			}
		}
	},
	find: function(tag) {
		var ret = null;
		this.walk(function(ctrl) {
			if(ctrl && ctrl.tag && ctrl.tag == tag)
				ret = ctrl;
			return !ret;
		});
		return ret;
	},
	_changeVisibility: function() {
		if(this.showScheduled) {
			this.showScheduled = false;
			if(this.isShown())
				this.hide();
			if(this.modal) {
				UI.windows.push(this);
			} else {
				for(var i=UI.windows.length-1; i>=0; i--)
					if(!UI.windows[i].modal) {
						UI.windows.splice(i,0,this);
						return;
					}
				UI.windows.unshift(this);
			}
		} else if(this.hideScheduled) {
			this.hideScheduled = false;
			var idx = UI.windows.indexOf(this);
			if(idx != -1)
				UI.windows.splice(idx,1);
		}
	},
	isShown: function() { return this.showScheduled || (UI.windows.indexOf(this) != -1 && !this.hideScheduled); },
	hide: function() {
		var self = this;
		this.showScheduled = false;
		this.hideScheduled = true;
		schedule(function() { self._changeVisibility(); });
	},
	show: function() {
		var self = this;
		this.showScheduled = true;
		this.hideScheduled = false;
		schedule(function() { self._changeVisibility(); });
	},
	dismiss: function() {
		if(this.modal && this.isShown()) {
			this.hide();
			if(this.ctrl && this.ctrl.onDismiss)
				this.ctrl.onDismiss();
			if(this.onDismiss)
				this.onDismiss();
		}
	},
	getFont: function() { return "default" in UI.fonts? UI.fonts["default"]: null; },
	getBgColour: function() { return UI.defaults.bgColour; },
	getFgColour: function() { return UI.defaults.fgColour; },
	layout: function() { this.needsLayout = true; }, // schedule the control to be laid out next time its drawn
	performLayout: function() { // perform the layout immediately
		this.needsLayout = false;
		if(this.ctrl)
			this.ctrl.layout();
	},
	window: function() { return this; },
	onMouseDown: function(evt,keys) { return this.ctrl && this.ctrl.onMouseDown? this.ctrl.onMouseDown(evt,keys): false; },
	onMouseMove: function(evt,keys,isMouseDown) { return this.ctrl && this.ctrl.onMouseMove? this.ctrl.onMouseMove(evt,keys,isMouseDown): false; },
	onMouseUp: function(evt,keys) { return this.ctrl && this.ctrl.onMouseUp? this.ctrl.onMouseUp(evt,keys): false; },
	onKeyDown: function(evt,keys) { return this.ctrl && this.ctrl.onKeyDown? this.ctrl.onKeyDown(evt,keys): false; },
	onKeyUp: function(evt,keys) { return this.ctrl && this.ctrl.onKeyUp? this.ctrl.onKeyUp(evt,keys): false; },
	onContextMenu: function(evt,keys) {
		if(this.ctrl && this.ctrl.onContextMenu)
			return this.ctrl.onContextMenu(evt,keys);
		this.dismiss();
		return this.modal;
	},
	setCtrl: function(ctrl) {
		this.ctrl = ctrl;
		this.dirty();
		if(!ctrl)
			this.children = [];
		else {
			this.children = [ctrl];
			ctrl.setParent(this);
			ctrl.layout();
		}
	},
};

var UI = {
	windows: [],
	windowIdSeq: 0,
	fonts: {},
	loadFont: function(name,path,callback) {
		var xml = null, texture = null;
		var done = function() {
			if(xml && texture) {
				console.log("loaded font",name,path);
				UI.fonts[name] = new UIFont(xml,texture);
				if(name == "default")
					UI.defaults.lineHeight = UI.fonts[name].lineHeight;
				for(var win in UI.windows)
					win = UI.windows[win].layout();
				if(callback)
					callback(UI.fonts[name]);
			}
		};
		loadFile("image",path+".png",function(arg) {
			texture = arg;
			done();
		});
		loadFile("xml",path+".xml",function(arg) {
			xml = arg;
			done();
		});
	},
	draw: function(canvas) {
		for(var window in this.windows)
			this.windows[window].draw(canvas);
	},
	onMouseDown: function(evt,keys) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if(window.onMouseDown(evt,keys) || window.modal)
				return true;
		}
		return false;
	},
	onMouseMove: function(evt,keys,isMouseDown) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if(window.onMouseMove(evt,keys,isMouseDown) || window.modal)
				return true;
		}
		return false;
	},
	onMouseUp: function(evt,keys) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if(window.onMouseUp(evt,keys) || window.modal)
				return true;
		}
		return false;
	},
	onKeyDown: function(evt,keys) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if(window.onKeyDown(evt,keys) || window.modal)
				return true;
		}
		return false;
	},
	onKeyUp: function(evt,keys) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if(window.onKeyUp(evt,keys) || window.modal)
				return true;
		}
		return false;
	},
	onContextMenu: function(evt,keys) {
		for(var i=this.windows.length; i-->0; ) {
			var window = this.windows[i];
			if((window.onContextMenu && window.onContextMenu(evt,keys)) || window.modal)
				return true;
		}
		return false;
	},
	defaults: {
		hpadding: 5,
		vpadding: 5,
		ihpadding: 1,
		ivpadding: 1,
		modalClear: [0.9,0.9,1,0.5],
		btn:{
			bgColour: [0.3,0.3,0.8,1],
			txtOutline: [0,0,0,0.5],
			fgColour: [1,1,1,1],
			disabled: {
				bgColour: [0.3,0.3,0.3,1],
				fgColour: [0.5,0.5,0.5,1],
			},
		},
		bgColour: [0.3,0.2,0.2,0.5],
		fgColour: [1.0,0.0,0.5,1.0],
		lineHeight: 13,
	},
};
UI.loadFont("default","bitstream_vera_sans");

function UIComponent() {
	assert(this !== window);
	this.children = [];
	this.isDirty = true;
	this.parent = null;
	this.x1 = this.y1 = this.x2 = this.y2 = 0;
}
UIComponent.prototype = {
	visible: true,
	enabled: true,
	pos: function() { return [this.x1,this.y1]; },
	setPos: function(pos) {
		var x = pos[0]-this.x1, y = pos[1]-this.y1;
		if(!x && !y) return;
		for(var child in this.children) {
			child = this.children[child];
			if(child)
				child.setPos([child.x1+x,child.y1+y]);
		}
		this.x1 += x; this.y1 += y;
		this.x2 += x; this.y2 += y;
		this.dirty();
	},
	setPosVisible: function(pos) {
		if(this.window().needsLayout)
			this.window().performLayout();
		this.setPos([
			Math.max(0,Math.min(pos[0],canvas.width-this.width())),
			Math.max(0,Math.min(pos[1],canvas.height-this.height()))]);
	},
	setSize: function(size) {
		if(size == this.size()) return;
		this.x2 = this.x1 + size[0];
		this.y2 = this.y1 + size[1];
		this.dirty();
	},
	setWidth: function(width) {
		if(width == this.width()) return;
		this.x2 = this.x1 + width;
		this.dirty();
	},
	width: function() { return this.x2 - this.x1; },
	height: function() { return this.y2 - this.y1; },
	size: function() { return [this.width(),this.height()]; },
	preferredSize: function() { return this.size(); },
	font: null,
	getFont: function() { return this.font || this.parent.getFont(); },
	fgColour: null,
	getFgColour: function() { return this.fgColour || this.parent.getFgColour(); },
	bgColour: null,
	getBgColour: function() { return this.bgColour || this.parent.getBgColour(); },
	layout: function() {
		if(this.layoutManager) {
			this.layoutManager.layout(this);
		} else {
			for(var child in this.children) {
				child = this.children[child];
				if(child)
					child.layout();
			}
			this.setSize(this.preferredSize());
		}
	},
	draw: function(ctx) {},
	dirty: function() {
		if(this.isDirty) return;
		this.isDirty = true;
		this.parent.dirty();
	},
	setParent: function(parent) {
		this.parent = parent;
		this.isDirty = true;
		for(var child in this.children) {
			child = this.children[child];
			if(child)
				child.setParent(this);
		}
	},
	addChild: function(child) {
		this.children.push(child);
		child.setParent(this);
		this.window().layout();
	},
	replaceChild: function(from,to) {
		var i = this.children.indexOf(from);
		if(i == -1)
			this.children.push(to);
		else
			this.children[i] = to;
		to.setParent(this);
		this.window().layout();
	},
	destroy: function() {
		if(!this.parent) return;
		var idx = this.parent.children.indexOf(this);
		if(idx != -1) {
			this.parent.children.splice(idx,1);
			this.parent.window().layout();
		}
	},
	window: function() { return this.parent.window(); },
	onMouseDown: function(evt,keys) {
		if(!this.visible || !this.enabled)
			return false;
		var	x = evt.clientX-evt.target.offsetLeft,
			y = evt.clientY-evt.target.offsetTop;
		if(x<this.x1 || x>=this.x2 ||
			y<this.y1 || y>=this.y2)
			return false;
		if(this.onClicked)
			this.onClicked(evt,keys);
		else
			for(var child in this.children) {
				child = this.children[child];
				if(child && child.onMouseDown(evt,keys))
					return true;
			}
		return false;
	},
};

var UILayoutFlow = {
	layout: function(ctrl) {
		var	h = 0,
			hpadding = this.hpadding || UI.defaults.hpadding,
			vpadding = this.vpadding || UI.defaults.vpadding,
			ipadding = this.ipadding || UI.defaults.ihpadding;
		for(var child in ctrl.children) {
			child = ctrl.children[child];
			if(!child || !child.visible) continue;
			child.layout();
			child.setSize(child.preferredSize());
			h = Math.max(h,child.height());
		}
		h += vpadding*2;
		var x = hpadding;
		for(var child in ctrl.children) {
			child = ctrl.children[child];
			if(!child || !child.visible) continue;
			child.setPos([ctrl.x1+x,ctrl.y1+(h-child.height())/2]);
			x += child.width() + ipadding;
		}
		x += (hpadding-ipadding);
		ctrl.setSize([x,h]);
	},
};

var UILayoutRows = {
	layout: function(ctrl) {
		var	w = 0,
			hpadding = this.hpadding || UI.defaults.hpadding,
			vpadding = this.vpadding || UI.defaults.vpadding,
			ipadding = this.ipadding || UI.defaults.ivpadding,
			h = vpadding;
		for(var child in ctrl.children) {
			child = ctrl.children[child];
			if(!child || !child.visible) continue;
			child.layout();
			child.setSize(child.preferredSize());
			child.setPos([ctrl.x1+hpadding,ctrl.y1+h]);
			w = Math.max(w,child.width());
			h += child.height() + ipadding;
		}
		h += (vpadding-ipadding);
		for(var child in ctrl.children) {
			child = ctrl.children[child];
			if(!child || !child.visible) continue;
			child.setWidth(w);
		}
		ctrl.setSize([w+hpadding*2,h]);
	},
};

function UIPanel(children,layout) {
	UIComponent.call(this);
	this.children = children || this.children;
	this.layoutManager = layout || this.layoutManager;
}
UIPanel.prototype = {
	__proto__: UIComponent.prototype,
	draw: function(ctx) {
		var margin = Math.min(UI.defaults.hpadding,UI.defaults.vpadding);
		ctx.fillRoundedRect(this.getBgColour(),margin,
			this.x1+margin,this.y1+margin,this.x2-margin,this.y2-margin);
	},
	layoutManager: UILayoutFlow,
};

function UILabel(text,outline) {
	UIComponent.call(this);
	this.text = text;
	this.outline = outline || this.outline;
}	
UILabel.prototype = {
	__proto__: UIComponent.prototype,
	outline: false,
	preferredSize: function() {
		var font = this.getFont();
		if(!font || !this.text) return [0,0];
		var ret = font.measureText(this.text);
		if(this.outline)
			return [ret[0]+3,ret[1]+3];
		return ret;
	},
	setText: function(text) {
		this.text = text;
		this.window().layout();
	},
	draw: function(ctx) {
		var font = this.getFont();
		if(this.outline)
			ctx.drawTextOutlined(font,this.getFgColour(),this.outline,this.x1,this.y1,this.text);
		else
			ctx.drawText(font,this.getFgColour(),this.x1,this.y1,this.text);
	},
};

function UICtrlIcon(name) {
	UIComponent.call(this);
	this.name = name;
	this.idx = this.mapping.indexOf(this.name);
	assert(this.idx >= 0,"unsupported mapping: "+this.name);
}		
UICtrlIcon.prototype = {
	__proto__: UIComponent.prototype,
	mapping: ["combo","submenu","checked","unchecked"],
	preferredSize: function() { return [UI.defaults.lineHeight,UI.defaults.lineHeight]; },
	draw: function(ctx) {
		if(!this.tex) return;
		var numIcons = this.tex.height / this.tex.width;
		ctx.drawRect(this.tex,this.getFgColour(),
			Math.max(this.x1,this.x2-this.height()),this.y1,
			this.x2,this.y2,
			0,this.idx/numIcons,
			1,(this.idx+1)/numIcons);
	},
};
loadFile("image","data/ctrl_icons.png",function(tex) { UICtrlIcon.prototype.tex = tex; });

function UIButton(text,onClick,tag,leftIcon,rightIcon) {
	assert(this != window);
	this.label = new UILabel(text,UI.defaults.btn.txtOutline);
	UIPanel.call(this,[leftIcon,this.label,rightIcon]);
	this.onClicked = onClick;
	this.tag = tag;
}
UIButton.prototype = {
	__proto__: UIPanel.prototype,
	getBgColour: function() {
		console.log("button is",this.enabled);
		return this.enabled? UI.defaults.btn.bgColour: UI.defaults.btn.disabled.bgColour;
	},
	getFgColour: function() {
		return this.enabled? UI.defaults.btn.fgColour: UI.defaults.btn.disabled.fgColour;
	},
	canFocus: true,
	setText: function(text) {
		var undefined;
		for(var child in this.children) {
			child = this.children[child];
			if(child && child.text !== undefined) {
				child.setText(text);
				return;
			}
		};
	},
};

function UIComboBox(options,idx,onSelect,tag) {
	this.options = options;
	this.idx = idx;
	this.onSelect = onSelect;
	UIButton.call(this,options[idx],this.onClicked,tag,null,new UICtrlIcon("combo"));
	this.label.preferredSize = function() {
		var	ret = [0,0],
			font = this.getFont();
		if(!font) return ret;
		for(var idx in options) {
			var sz = font.measureText(options[idx]);
			ret[0] = Math.max(ret[0],sz[0]);
			ret[1] = Math.max(ret[1],sz[1]);
		}
		if(this.outline)
			return [ret[0]+3,ret[1]+3];
		return ret;
	};
}
UIComboBox.prototype = {
	__proto__: UIButton.prototype,
	onClicked: function(evt,keys) {
		var	ctrl = this,
			list = new UIPanel([],UILayoutRows),
			menu = new UIWindow(true,list);
		for(var idx in this.options)
			list.addChild(new UIButton(this.options[idx],function() {
				ctrl.setIdx(this.tag);
				menu.dismiss();
				if(ctrl.onSelect)
					ctrl.onSelect(ctrl.options[ctrl.idx]);
				return true;
			},idx,new UICtrlIcon(idx==this.idx?"checked":"unchecked")));
		menu.layout();
		list.setPosVisible(this.pos());
		menu.show();
		return true;
	},
	setIdx: function(idx) {
		this.idx = idx;
		this.setText(this.options[idx]);		
	},
};

function Perf() {
	var perf = new UIComponent();
	new UIWindow(false,perf); // creates a window for it
	perf.label = UILabel("fps");
	perf.addChild(UIPanel([perf.label]));
	perf.data = new Float32Array(2*6*60*3),
	perf.slot = 0,
	perf.now = function() { return Date.now()/1000.0; };
	perf.start = perf.now();
	perf.tick = function() {
		var t = perf.now() - perf.start, w = 1.0/60;
		var pts = [t,1,t+w,1,t,0,t+w,1,t,0,t+w,0]; // 2 triangles
		perf.data.set(pts,perf.slot);
		perf.slot += pts.length;
		if(perf.slot >= perf.data.length) perf.slot = 0;
		perf.label.text = perf.fps(3).toFixed(2)+" fps";
		perf.setPos([canvas.width-(perf.children[0].preferredSize()[0]+10),10]);
		perf.layout();
	};
	perf.fps = function(secs) {
		var min = 0, count = 0,
			now = perf.now() - perf.start,
			since = now - secs;
		for(var tick=0; tick<perf.data.length; tick+=6) {
			var t = perf.data[tick];
			if(t && t > since) {
				min = Math.min(t,min) || t;
				count++;
			}
		}
		if(min < now-Math.min(1,secs))
			return count / (now-min);
		return -1;
	};
	return perf;
}
