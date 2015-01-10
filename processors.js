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

	/**
	 * 
	 * receivedLocation - emitted when a location message is received
	 * 
	 * @event receivedLocation
	 * @type {object}
	 * @property {string} from       Sender JID
	 * @property {string} id         Message ID
	 * @property {number} latitude
	 * @property {number} longitude
	 * @property {string} name       Name of the place
	 * @property {string} url        URL of the place (usually foursquare)
	 * @property {number} timestamp  Message UNIX timestamp
	 * @property {string} notify
	 * @property {object} body       Raw body (thumbnail of the map)
	 * @example
	 * wa.on('receivedLocation', function(from, id, latitude, longitude, name, url, t, notify, thumbData){
	 *   console.log(
	 *     "Received location:\n From: %s\n id: %s\n latitude: %d\n longitude: %s\n name: %s \n url: %s \n t: %s\n notify: %s",
	 *     from, id, latitude, longitude, name, url, t, notify
	 *   );
	 *   fs.writeFile('whatsapi/media/location-'+latitude+'-'+longitude+'-thumb.jpg', thumbData);
	 * });
	 */
	this.adapter.emit(
		'receivedLocation',
		node.attribute('from'),
		node.attribute('id'),
		location.attribute('latitude'),
		location.attribute('longitude'),
		location.attribute('name'),
		location.attribute('url'),
		node.attribute('t'),
		node.attribute('notify'),
		location.data()
	);
};

function Media() {}

util.inherits(Media, Abstract);

Media.prototype.match = function(node) {
	return node.attribute('notify') &&
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
	 * receivedImage - event
	 *  
	 * @event receivedImage
	 * @type {object}
	 * @property {string} from
	 * @property {string} id
	 * @property {string} size
	 * @property {string} url
	 * @property {string} caption - optional caption. Empty string when not provided
	 * @property {string} encoding
	 * @property {string} ip
	 * @property {string} mimetype
	 * @property {string} filehash
	 * @property {string} width
	 * @property {string} height
	 * @property {Buffer} thumbnailData
	 * @example
	 * wa.on('reveivedImage', function(from, id, size, url, caption, file, encoding, ip, mimetype, filehash, width, height, thumbData){
	 *   console.log(
	 *     "Received image:\n From: %s\n id: %s\n size: %d bytes\n url: %s\n caption: %s \n file: %s\n encoding: %s\n ip: %s\n mimetype: %s\n filehash: %s\n width: %d px\n height: %d px",
	 *     from, id, size, url, caption, file, encoding, ip, mimetype, filehash, width, height
	 *   );
	 *   fs.writeFile('whatsapi/media/image-'+from+'-'+file+'-thumb.jpg', thumbData); 
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
		'receivedImage',
		node.attribute('from'),
		node.attribute('id'),
		image.attribute('size'),
		image.attribute('url'),
		image.attribute('caption') || '',
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

/**			
 * reveivedVideo - event
 *  
 * @event reveivedVideo
 * @type {object}
 * @property {string} from
 * @property {string} id
 * @property {string} url
 * @property {string} caption
 * @property {string} seconds
 * @property {string} file
 * @property {string} encoding
 * @property {string} size
 * @property {string} ip
 * @property {string} mimetype
 * @property {string} filehash
 * @property {string} duration
 * @property {string} vcodec
 * @property {string} width
 * @property {string} height
 * @property {string} fps
 * @property {string} vbitrate
 * @property {string} acodec
 * @property {string} asampfreq
 * @property {string} asampfmt
 * @property {string} abitrate
 * @property {Buffer} thumbnailData
 * @example
 * wa.on('receivedVideo', function(from, id, url, caption, seconds, file, encoding, size, ip, mimetype, filehash, duration, vcodec, width, height, fps, vbitrate, acodec, asampfreq, asampfmt, abitrate, thumbData){
 * console.log(
 *     "Received video:\n from: %s \n id: %s \n url: %s \n caption: %s \n seconds: %s \n file: %s \n encoding: %s \n size: %s bytes\n ip: %s \n mimetype: %s \n filehash: %s \n duration: %s sec\n vcodec: %s \n width: %s px\n height: %s px\n fps: %s \n vbitrate: %s bit/s\n acodec: %s \n asampfreq: %s \n asampfmt: %s \n abitrate %s bit/s",
 *     from, id, url, caption, seconds, file, encoding, size, ip, mimetype, filehash, duration, vcodec, width, height, fps, vbitrate, acodec, asampfreq, asampfmt, abitrate
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

Video.prototype.process = function(node) {
	var video = node.child('media');

	this.adapter.emit(
		'receivedVideo',
		node.attribute('from'),
		node.attribute('id'),
		video.attribute('url'),
		video.attribute('caption') || '',
		video.attribute('seconds'),
		video.attribute('file'),
		video.attribute('encoding'),
		video.attribute('size'),
		video.attribute('ip'),
		video.attribute('mimetype'),
		video.attribute('filehash'),
		video.attribute('duration'),
		video.attribute('vcodec'),
		video.attribute('width'),
		video.attribute('height'),
		video.attribute('fps'),
		video.attribute('vbitrate'),
		video.attribute('acodec'),
		video.attribute('asampfreq'),
		video.attribute('asampfmt'),
		video.attribute('abitrate'),
		video.data()
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

function Vcard() {
	this.type = 'vcard';
}

util.inherits(Vcard, Media);

Vcard.prototype.process = function(node) {
	var vcard = node.child('media').child('vcard');

	/**			
	* receivedVcard - event
	*  
	* @event receivedVcard
	* @type {object}
	* @property {string} from
	* @property {string} id
	* @property {string} name
	* @property {Buffer} vcardData
	* @example
	* wa.on('receivedVcard', function(from, id, name, vcardData){
	*   console.log("Received vCard:\n From: %s\n id: %s\n name: %s", from, id, name);
	*   fs.writeFile('whatsapi/media/vcard-'+from+'-'+name+'.vcard', vcardData);
  * });
	*/		
	this.adapter.emit(
		'receivedVcard',
		node.attribute('from'),
		node.attribute('id'),
		vcard.attribute('name'),
		vcard.data()
	);
};

function createProcessor() {
	return new Aggregate([new Text, new Location, new Image, new Video, new Audio, new Vcard]);
}

exports.createProcessor = createProcessor;
