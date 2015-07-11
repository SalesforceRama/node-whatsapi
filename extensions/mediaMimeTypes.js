// Media MIME types submodule
// Includes media types definitions

var MediaType = require('../MediaType.js');
var WhatsApi = module.exports = function() {};

// helper
function convertMBToBytes(mb) {
	return (mb * (1024 * 1024));
}

WhatsApi.prototype.mediaMimeTypes = {};

WhatsApi.prototype.mediaMimeTypes[MediaType.IMAGE] = {
	size : convertMBToBytes(5),
	mime : ['image/png', 'image/jpeg', 'image/jpg']
};

WhatsApi.prototype.mediaMimeTypes[MediaType.VIDEO] = {
	size : convertMBToBytes(20),
	mime : ['video/mp4', 'video/quicktime', 'video/x-msvideo']
};

WhatsApi.prototype.mediaMimeTypes[MediaType.AUDIO] = {
	size : convertMBToBytes(10),
	mime : [
		'video/3gpp',
		'audio/x-caf',
		'audio/x-wav',
		'audio/mpeg',
		'audio/x-ms-wma',
		'video/ogg',
		'audio/x-aiff',
		'audio/x-aac'
	]
};

WhatsApi.prototype.mediaMimeTypes[MediaType.VCARD] = {
	size : convertMBToBytes(10),
	mime : [
	'text/x-vcard',
	'text/directory;profile=vCard',
	'text/directory'
	]
};
