var util = require('util');

function Abstract() {}

Abstract.prototype.setAdapter = function(adapter) {
	this.adapter = adapter;
};

Abstract.prototype.match = function() {
	return false;
};

function Aggregate(list) {
	this.list = list;
}

Aggregate.prototype.setAdapter = function(adapter) {
	this.adapter = adapter;

	this.list.forEach(function(processor) {
		processor.setAdapter(adapter);
	}, this);
};

Aggregate.prototype.process = function(node) {
	this.list.forEach(function(processor) {
		if(processor.match(node)) {
			processor.process(node);
		}
	}, this);
};

function Text() {}

util.inherits(Text, Abstract);

Text.prototype.match = function(node) {
	return node.child('notify') && node.child('body');
};

Text.prototype.process = function(node) {
	this.adapter.emit(
		'message',
		node.attribute('from'),
		node.attribute('id'),
		node.child('notify').attribute('name'),
		node.child('body').data(),
		node.attribute('author')
	);
};

function Location() {}

util.inherits(Location, Abstract);

Location.prototype.match = function(node) {
	return node.child('notify') && node.child('media') && node.child(2).attribute('type') == 'location';
};

Location.prototype.process = function(node) {
	var location = node.child(2);

	this.adapter.emit(
		'message.location',
		node.attribute('from'),
		node.attribute('id'),
		node.child(0).attribute('name'),
		location.attribute('latitude'),
		location.attribute('longitude'),
		location.attribute('name'),
		location.attribute('url'),
		node.attribute('author')
	);
};

function Media() {}

util.inherits(Media, Abstract);

Media.prototype.match = function(node) {
	return node.child('notify') &&
		   node.child(0).attribute('name') &&
		   node.child('media') &&
		   node.child(2).attribute('type') === this.type;
};

function Image() {
	this.type = 'image';
}

util.inherits(Image, Media);

Image.prototype.process = function(node) {
	var image = node.child(2);

	this.adapter.emit(
		'message.image',
		node.attribute('from'),
		node.attribute('id'),
		node.child(0).attribute('name'),
		image.attribute('size'),
		image.attribute('url'),
		image.attribute('file'),
		image.attribute('mimetype'),
		image.attribute('filehash'),
		image.attribute('width'),
		image.attribute('height'),
		image.data(),
		node.attribute('author')
	);
};

function Video() {
	this.type = 'video';
}

util.inherits(Video, Media);

Video.prototype.process = function(node) {
	var video = node.child(2);

	this.adapter.emit(
		'message.video',
		node.attribute('from'),
		node.attribute('id'),
		node.child(0).attribute('name'),
		video.attribute('size'),
		video.attribute('url'),
		video.attribute('file'),
		video.attribute('mimetype'),
		video.attribute('filehash'),
		video.attribute('duration'),
		video.attribute('vcodec'),
		video.attribute('acodec'),
		video.data(),
		node.attribute('author')
	);
};

function Audio() {
	this.type = 'audio';
}

util.inherits(Audio, Media);

Audio.prototype.process = function(node) {
	var audio = node.child(2);

	this.adapter.emit(
		'message.audio',
		node.attribute('from'),
		node.attribute('id'),
		node.child(0).attribute('name'),
		audio.attribute('size'),
		audio.attribute('url'),
		audio.attribute('file'),
		audio.attribute('mimetype'),
		audio.attribute('filehash'),
		audio.attribute('duration'),
		audio.attribute('acodec'),
		node.attribute('author')
	);
};

function createProcessor() {
	return new Aggregate([new Text, new Location, new Image, new Video, new Audio]);
}

exports.createProcessor = createProcessor;
