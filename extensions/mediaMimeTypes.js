// Media MIME types submodule
// Includes media types definitions

var MediaType = require('../MediaType.js');
/**
 * @alias WhatsApi
 */
var WhatsApi = module.exports;

/**
 * @private
 * @instance
 */
WhatsApi.mediaMimeTypes = {};

WhatsApi.mediaMimeTypes[MediaType.IMAGE] = {
	size : 5 * 1024 * 1024,
	mime : ['image/png', 'image/jpeg']
};

WhatsApi.mediaMimeTypes[MediaType.VIDEO] = {
	size : 20 * 1024 * 1024,
	mime : ['video/mp4', 'video/quicktime', 'video/x-msvideo']
};

WhatsApi.mediaMimeTypes[MediaType.AUDIO] = {
	size : 10 * 1024 * 1024,
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

WhatsApi.mediaMimeTypes[MediaType.VCARD] = {
	size : 10 * 1024 * 1024,
	mime : [
	'text/x-vcard',
	'text/directory;profile=vCard',
	'text/directory'
	]
};
