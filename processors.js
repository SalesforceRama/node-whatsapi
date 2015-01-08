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
	return node.attribute('notify') && node.attribute('type') == 'text'
		&& node.child('body');
};

Text.prototype.process = function(node) {
	this.adapter.emit(
		'message',
		node.child('body').data().toString('utf8'),
		node.attribute('from'),
		node.attribute('id'),
		node.attribute('t'),
		node.attribute('notify'),
		node.attribute('author')
	);
};

function Location() {}

util.inherits(Location, Abstract);

Location.prototype.match = function(node) {
	return node.attribute('notify') && node.child('media')
		&& node.child('media').attribute('type') == 'location';
};

Location.prototype.process = function(node) {
	var location = node.child('media');

	this.adapter.emit(
		'message.location',
		node.attribute('from'),
		node.attribute('id'),
		location.attribute('latitude'),
		location.attribute('longitude'),
		location.attribute('name'),
		location.attribute('url'),
		node.attribute('t'),
		node.attribute('notify')
	);
};

function Media() {}

util.inherits(Media, Abstract);

Media.prototype.match = function(node) {
	return node.attribute('notify') &&
//		   node.child(0).attribute('name') &&
		   node.child('media') &&
		   node.child('media').attribute('type') === this.type;
};

function Image() {
	this.type = 'image';
}

util.inherits(Image, Media);

Image.prototype.process = function(node) {
	var image = node.child('media');

	/**			
	 * reveivedImage - event
	 *  
	 * @event reveivedImage
	 * @type {object}
	 * @property {string} from
	 * @property {string} id
	 * @property {integer} size
	 * @property {string} url
	 * @property {string} encoding
	 * @property {string} ip
	 * @property {string} mimetype
	 * @property {string} filehash
	 * @property {string} width
	 * @property {string} height
	 * @property {Buffer} thumbnailData
	 * @example
	 * wa.on('reveivedImage', function(from, id, size, url, file, encoding, ip, mimetype, filehash, width, height, thumbData){
	 *   console.log(
	 *     "Received image:\n From: %s\n id: %s\n size: %d bytes\n url: %s\n file: %s\n encoding: %s\n ip: %s\n mimetype: %s\n filehash: %s\n width: %d px\n height: %d px",
	 *     from, id, size, url, file, encoding, ip, mimetype, filehash, width, height
	 *   );
	 *   fs.writeFile('whatsapi/media/video-'+from+'-'+file+'-thumb.jpg', thumbData); 
	 *   wa.downloadMediaFile(url,function(err,path){
	 *     if(err){
	 *       console.log('error storing file: ' + err);
	 *     }else{
	 *       console.log('file downloaded at: '+ path);
	 *     }
	 *   });
	 * });
	 */			
	this.adapter.emit(
		'reveivedImage',
		node.attribute('from'),
		node.attribute('id'),
		image.attribute('size'),
		image.attribute('url'),
		image.attribute('file'),
		image.attribute('encoding'),
		image.attribute('ip'),
		image.attribute('mimetype'),
		image.attribute('filehash'),
		image.attribute('width'),
		image.attribute('height'),
		image.data()
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
