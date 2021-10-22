import Item from "./item.js";
import * as svg from "./svg.js";
import Layout, { repo as layoutRepo } from "./layout/layout.js";


interface Options {
	root: string;
	layout: Layout;
}


export default class Map {
	readonly node = svg.node("svg");
	protected _root: Item;

	// fixme
	_position = [0, 0];
	_visible = false;

	constructor(options?: Partial<Options>) {
		options = Object.assign({
			root: "My Mind Map",
			layout: layoutRepo.get("map")
		}, options);

		let root = new Item();
		root.text = options.root;
		root.layout = options.layout;
		this.root = root;
	}

	static fromJSON(data) {
		return new this().fromJSON(data);
	}

	toJSON() {
		var data = {
			root: this._root.toJSON()
		};
		return data;
	}

	fromJSON(data) {
		this.root = Item.fromJSON(data.root);
		return this;
	}

	get root() { return this._root; }
	protected set root(root: Item) {
		const { node } = this;
		this._root = root;

		node.innerHTML = "";
		node.append(root.dom.node);

		root.parent = this;
	}

	mergeWith(data) {
		/* store a sequence of nodes to be selected when merge is over */
		var ids = [];
		var current = MM.App.current;
		var node = current;
		while (node != this) {
			ids.push(node.id);
			node = node.parent;
		}

		this._root.mergeWith(data.root);

		if (current.map) { /* selected node still in tree, cool */
			/* if one of the parents got collapsed, act as if the node got removed */
			var node = current.parent;
			var hidden = false;
			while (node != this) {
				if (node.isCollapsed()) { hidden = true; }
				node = node.parent;
			}
			if (!hidden) { return; } /* nothing bad happened, continue */
		}

		/* previously selected node is no longer in the tree OR it is folded */

		/* what if the node was being edited? */
		if (MM.App.editing) { current.stopEditing(); }

		/* get all items by their id */
		var idMap = {};
		var scan = function(item) {
			idMap[item.id] = item;
			item.children.forEach(scan);
		}
		scan(this._root);

		/* select the nearest existing parent */
		while (ids.length) {
			var id = ids.shift();
			if (id in idMap) {
				MM.App.select(idMap[id]);
				return;
			}
		}
	}

	get isVisible() { return !!this.node.parentNode; }

	update() {
		this._root.update({parent:true, children:true});
		return this;
	}

	show(where: HTMLElement) {
		const { node } = this;

		where.append(node);
		this._visible = true;
		this._root.update({parent:true, children:true});

		// fixme presunout do update od potomka
		const { size } = this._root;
		node.setAttribute("width", String(size[0]));
		node.setAttribute("height", String(size[1]));

		this.center();
		MM.App.select(this._root);

		return this;
	}

	hide() {
		this.node.remove();
		this._visible = false;
		return this;
	}

	center() {
		let { size } = this._root;
		var port = MM.App.portSize;
		var left = (port[0] - size[0])/2;
		var top = (port[1] - size[1])/2;

		this._moveTo([Math.round(left), Math.round(top)]);

		return this;
	}

	moveBy(diff: number[]) {
		let position = this._position.map((p, i) => p + diff[i]);
		return this._moveTo(position);
	}

	getClosestItem(x, y) {
		var all = [];

		var scan = function(item) {
			var rect = item.dom.content.getBoundingClientRect();
			var dx = rect.left + rect.width/2 - x;
			var dy = rect.top + rect.height/2 - y;
			all.push({
				item: item,
				dx: dx,
				dy: dy
			});
			if (!item.isCollapsed()) { item.children.forEach(scan); }
		}

		scan(this._root);

		all.sort(function(a, b) {
			var da = a.dx*a.dx + a.dy*a.dy;
			var db = b.dx*b.dx + b.dy*b.dy;
			return da-db;
		});

		return all[0];
	}

	getItemFor(node) {
		var port = this._root.dom.node.parentNode;
		while (node != port && !node.classList.contains("content")) {
			node = node.parentNode;
		}
		if (node == port) { return null; }

		var scan = function(item, node) {
			if (item.dom.content == node) { return item; }
			var children = item.children;
			for (var i=0;i<children.length;i++) {
				var result = scan(children[i], node);
				if (result) { return result; }
			}
			return null;
		}

		return scan(this._root, node);
	}

	ensureItemVisibility(item: Item) {
		const padding = 10;

		let itemRect = item.dom.content.getBoundingClientRect();
		var parentRect = (this.node.parentNode as HTMLElement).getBoundingClientRect();

		var delta = [0, 0];

		var dx = parentRect.left-itemRect.left+padding;
		if (dx > 0) { delta[0] = dx; }
		var dx = parentRect.right-itemRect.right-padding;
		if (dx < 0) { delta[0] = dx; }

		var dy = parentRect.top-itemRect.top+padding;
		if (dy > 0) { delta[1] = dy; }
		var dy = parentRect.bottom-itemRect.bottom-padding;
		if (dy < 0) { delta[1] = dy; }

		if (delta[0] || delta[1]) { this.moveBy(delta); }
	}

	get name() {
		let name = this._root.text;
		return MM.Format.br2nl(name).replace(/\n/g, " ").replace(/<.*?>/g, "").trim();
	}

	get id() { return this._root.id; }

	pick(item, direction) {
		var candidates = [];
		var currentRect = item.dom.content.getBoundingClientRect();

		this._getPickCandidates(currentRect, this._root, direction, candidates);
		if (!candidates.length) { return item; }

		candidates.sort(function(a, b) {
			return a.dist - b.dist;
		});

		return candidates[0].item;
	}

	_getPickCandidates(currentRect, item, direction, candidates) {
		if (!item.isCollapsed()) {
			item.children.forEach(function(child) {
				this._getPickCandidates(currentRect, child, direction, candidates);
			}, this);
		}

		var node = item.dom.content;
		var rect = node.getBoundingClientRect();

		if (direction == "left" || direction == "right") {
			var x1 = currentRect.left + currentRect.width/2;
			var x2 = rect.left + rect.width/2;
			if (direction == "left" && x2 > x1) { return; }
			if (direction == "right" && x2 < x1) { return; }

			var diff1 = currentRect.top - rect.bottom;
			var diff2 = rect.top - currentRect.bottom;
			var dist = Math.abs(x2-x1);
		} else {
			var y1 = currentRect.top + currentRect.height/2;
			var y2 = rect.top + rect.height/2;
			if (direction == "top" && y2 > y1) { return; }
			if (direction == "bottom" && y2 < y1) { return; }

			var diff1 = currentRect.left - rect.right;
			var diff2 = rect.left - currentRect.right;
			var dist = Math.abs(y2-y1);
		}

		var diff = Math.max(diff1, diff2);
		if (diff > 0) { return; }
		if (!dist || dist < diff) { return; }

		candidates.push({item:item, dist:dist});
	}

	_moveTo(point: number[]) {
		this._position = point;
		this.node.style.left = `${point[0]}px`;
		this.node.style.top = `${point[1]}px`;
	}
}
