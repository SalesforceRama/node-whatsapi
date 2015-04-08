var util        = require('util');
var events      = require('events');
var fs          = require('fs');
var crypto      = require('crypto');
var url         = require('url');
var tls         = require('tls');
var http        = require('http');
var https       = require('https');
var querystring = require('querystring');
var jimp        = require('jimp');
var gm          = require('gm');
var mime        = require('mime');
var path        = require('path');
var common      = require('./common');
var dictionary  = require('./dictionary');
var protocol    = require('./protocol');
var transports  = require('./transport');
var encryption  = require('./encryption');
var processors  = require('./processors');
var wareg       = require('./whatsapiregistration');


var MediaType = {
	IMAGE : 'image',
	VIDEO : 'video',
	AUDIO : 'audio',
	VCARD : 'vcard'
};

var ImageTools = {
	JIMP: 'jimp',
	IMAGEMAGICK: 'imagemagick',
	GRAPHICSMAGICK: 'graphicsmagick'
};

/**
 * Constructor for WhatsApi
 * @class
 * @param {WhatsApiConfig} config
 * @param {Reader} reader
 * @param {Writer} writer
 * @param {Processor} processor
 * @param {Transport} transport
 */
function WhatsApi(config, reader, writer, processor, transport) {
	this.config    = common.extend({}, this.defaultConfig, config);
	this.reader    = reader;
	this.writer    = writer;
	this.processor = processor;
	this.transport = transport;

	events.EventEmitter.call(this);

	this.init();
}

util.inherits(WhatsApi, events.EventEmitter);

/**
* @typedef WhatsApiConfig
* @type {Array}
* @property {String} msisdn - phone number in international format, without leading '+'. E.g. 491234567890
* @property {String} device_id - Device ID (only used for registration)
* @property {String} username - User name
* @property {String} password - Password provided by WhatsApp upon registration
* @property {String} ccode -  MCC (Mobile Country Code) See documentation at http://en.wikipedia.org/wiki/Mobile_country_code
* @property {Boolean} reconnect - specify true for automatic reconnect upon disconnect
* @property {String} host - host URI of the WhatsApp server
* @property {String} server - server URI (not used for connecting)
* @property {String} gserver - group server URI (not used for connecting)
* @property {Number} port - port number to connect to WhatsApp server
* @property {String} device_type
* @property {String} app_version - version of the WhatsApp App to use in communication
* @property {String} ua - user agent string to use in communication
* @property {String} challenge_file - path to challenge file
*/

/** @type {WhatsApiConfig} */
WhatsApi.prototype.defaultConfig = {
	msisdn         : '',
	device_id      : '',
	username       : '',
	password       : '',
	ccode          : '',
	reconnect      : true,
	host           : 'c.whatsapp.net',
	server         : 's.whatsapp.net',
	gserver        : 'g.us',
	port           : 443,
	device_type    : 'iPhone',
	app_version    : '2.11.16',
	ua             : 'WhatsApp/2.11.473 Android/4.3 Device/GalaxyS3',
	challenge_file : path.join(__dirname, 'challenge'),
	imageTool      : ImageTools.JIMP
};

WhatsApi.prototype.mediaMimeTypes = {};

WhatsApi.prototype.mediaMimeTypes[MediaType.IMAGE] = {
	size : 5 * 1024 * 1024,
	mime : ['image/png', 'image/jpeg']
};

WhatsApi.prototype.mediaMimeTypes[MediaType.VIDEO] = {
	size : 20 * 1024 * 1024,
	mime : ['video/mp4', 'video/quicktime', 'video/x-msvideo']
};

WhatsApi.prototype.mediaMimeTypes[MediaType.AUDIO] = {
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

WhatsApi.prototype.mediaMimeTypes[MediaType.VCARD] = {
	size : 10 * 1024 * 1024,
	mime : [
	'text/x-vcard',
	'text/directory;profile=vCard',
	'text/directory'
	]
};

/**
 * Initializes WhatsApi
 * Internal method, should not be called externally
 */
WhatsApi.prototype.init = function() {
	this.transport.onReceive(this.onTransportData, this);
	this.transport.onError(this.onTransportError, this);
	this.transport.onEnd(this.onTransportEnd, this);

	this.connected   = false;
	this.challenge   = null;
	this.messageId   = 0;
	this.queue       = [];
	this.loggedIn    = false;
	this.mediaQueue  = {};
	this.selfAddress = this.createJID(this.config.msisdn);
	
	// Callbacks
	this.connectCallback = null;
	this.loginCallback = null;
	this.callbacksCollection = [];

	this.processor.setAdapter(this);
};

/**
 * Add a new callback to the queue
 * @param  {String}   id   The id of the message that's being sent
 * @param  {Function} cb   The callback to be called when a response for the message is received
 */
WhatsApi.prototype.addCallback = function(id, cb) {
	if (!id || !cb) {
		return;
	}
	this.callbacksCollection.push({ id: id, callback: cb });
};

/**
 * Execute the callback for the provided message id and remove it from the queue
 * @param  {String} id    The id of the received message
 * @param  {Array} args   The parameters to be passed to the called callback
 */
WhatsApi.prototype.executeCallback = function(id, args) {
	if (!Array.isArray(args)) {
		args = [args];
	}
	
	for (var i = 0; i < this.callbacksCollection.length; i++) {
		var item = this.callbacksCollection[i];
		if (item.id == id) {
			// Call the callback
			item.callback && item.callback.apply(this, args);
			// Remove it
			this.callbacksCollection.splice(i--, 1);
		}
	};
};

/**
 * Connect to the WhatsApp server using the connection parameters specified in the configuration
 */
WhatsApi.prototype.connect = function(callback) {
	this.loggedIn = false;
	if (callback) {
		this.connectCallback = callback;
	}
	this.transport.connect(this.config.host, this.config.port, this.onTransportConnect, this);
};

/**
 * Disconnect from the WhatsApp server
 */
WhatsApi.prototype.disconnect = function() {
	this.transport.disconnect();
};

WhatsApi.prototype.login = function(callback) {
	if (this.loggedIn) {
		return;
	}
	if (callback) {
		this.loginCallback = callback;
	}
	
	this.reader.setKey(null);
	this.writer.setKey(null);

	var resource = [this.config.device_type, this.config.app_version, this.config.port].join('-');

	this.send(this.writer.stream(this.config.server, resource));
	this.sendNode(this.createFeaturesNode());
	this.sendNode(this.createAuthNode());
};

WhatsApi.prototype.isLoggedIn = function() {
	return this.loggedIn;
};

/**
 * Send online presence for the current user
 */
WhatsApi.prototype.sendIsOnline = function() {
	var attributes = {
		name : this.config.username
	};

	this.sendNode(new protocol.Node('presence', attributes));
};

/**
 * Send offline presence for the current user
 */
WhatsApi.prototype.sendIsOffline = function() {
	var attributes = {
		type : 'unavailable',
		name : this.config.username
	};

	this.sendNode(new protocol.Node('presence', attributes));
};

/**
 * Send composing state to the given user
 * @param  {String} to     Phone number
 */
WhatsApi.prototype.sendComposingState = function(to) {
	this.sendChatState(to, 'composing');
};

/**
 * Send stopped typing/composing to the given user
 * @param  {String} to     Phone number
 */
WhatsApi.prototype.sendPausedState = function(to) {
	this.sendChatState(to, 'paused');
};

WhatsApi.prototype.sendChatState = function(to, state) {
	var node = new protocol.Node(
		'chatstate',
		{
			to: this.createJID(to)
		},
		[
			new protocol.Node(state || 'paused')
		]
	);

	this.sendNode(node);
};

/**
 * Send a text message
 * @param  {String} to      Recipient number or JID
 * @param  {String} message Message text content
 * @param  {String} msgid   Message ID (optional)
 */
WhatsApi.prototype.sendMessage = function(to, message, msgid) {
	this.sendMessageNode(to, new protocol.Node('body', null, null, message), msgid);
};

/**
 * Send a location message
 * @param  {String} to    Recipient number or JID
 * @param  {Number} lat   Latitude
 * @param  {Number} lng   Longitude
 * @param  {String} name  Place name (optional)
 * @param  {String} url   Place URL (optional)
 * @param  {String} msgid Message ID (optional)
 */
WhatsApi.prototype.sendLocation = function(to, lat, lng, name, url, msgid) {
	var attributes = {
		encoding  : 'raw',
		type      : 'location',
		latitude  : lat.toString(),
		longitude : lng.toString()
	};
	
	if (name) attributes['name'] = name;
	if (url) attributes['url'] = url;
	
	var node = new protocol.Node('media', attributes);

	this.sendMessageNode(to, node, msgid);
};


/**
 * Send an image to the specified destination. An optional caption an message ID can be specified.
 * 
 * @param  {String} to       destination phone number in international format, without '+'. E.g. 491234567890
 * @param  {String} filepath file path or URL of the image to send
 * @param  {String} caption  (optional) caption to display together with the image
 * @param  {String} msgid    (optional) message ID
 * @example
 * wa.sendImage('491234567890', 'http://lorempixel.com/800/600/?.jpg', 'This is a caption');
 */
WhatsApi.prototype.sendImage = function(to, filepath, caption, msgid) {
	this.sendMedia(to, filepath, MediaType.IMAGE, caption, msgid);
};

/**
* Send a video to the specified destination. An optional caption an message ID can be specified.
* 
* @param  {String} to       destination phone number in international format, without '+'. E.g. 491234567890
* @param  {String} filepath file path or URL of the video to send
* @param  {String} caption  (optional) caption to display together with the video
* @param  {String} msgid    (optional) message ID
* @example
* wa.sendVideo('491234567890','http://clips.vorwaerts-gmbh.de/big_buck_bunny.mp4', 'Big Buck Bunny');
*/
WhatsApi.prototype.sendVideo = function(to, filepath, caption, msgid) {
	this.sendMedia(to, filepath, MediaType.VIDEO, caption, msgid);
};

/**
 * Send an audio file to the specified destination.
 * 
 * @param  {String} to       destination phone number in international format, without '+'. E.g. 491234567890
 * @param  {String} filepath file path or URL of the audio file to send
 * @param  {String} msgid    (optional) message ID
 * @example
 * wa.sendAudio('491234567890', 'http://archive.org/download/Exodus1KJV/02001_Exodus_1.mp3');
 */
WhatsApi.prototype.sendAudio = function(to, filepath, msgid) {
	this.sendMedia(to, filepath, MediaType.AUDIO, null, msgid);
};

WhatsApi.prototype.sendMedia = function(to, filepath, type, caption, msgid) {
	this.getMediaFile(filepath, type, function(err, path) {
		if(err) {
			this.emit('mediaError', err);
			return;
		}

		var stat = fs.statSync(path);
		var hash = crypto.createHash('sha256').update(fs.readFileSync(path)).digest('base64');

		this.sendNode(this.createRequestMediaUploadNode(hash, type, stat.size, path, to, caption, msgid));
	}.bind(this));
};

/**
 * Send a vCard file to the specified destination.
 * 
 * @param  {String} to       destination phone number in international format, without '+'. E.g. 491234567890
 * @param  {String} filepath file path or URL of the vCard file to send
 * @param  {String} name     name of the person in the vcard
 * @param  {String} msgid    (optional) message ID
 * @example
 * wa.sendVcard('491234567890', 'http://www.w3.org/2002/12/cal/vcard-examples/john-doe.vcf', 'John Doe');
 */
WhatsApi.prototype.sendVcard = function(to, filepath, name, msgid) {
	this.getMediaFile(filepath, MediaType.VCARD, function(err, path) {
		if(err) {
			this.emit('mediaError', err);
			return;
		}
		
		fs.readFile(path, function(err, data) {
			if(err) {
				this.emit('mediaError', err);
				return;
			}

			var vcardNode = new protocol.Node('vcard', {name: name}, null, data);
			var mediaNode = new protocol.Node('media', {type: 'vcard'}, [vcardNode], null);
			
			this.sendMessageNode(to, mediaNode, msgid);
			
		}.bind(this));
	}.bind(this));
};

/*
 *
 * GROUPS
 *
 */

/**
 * Request a filtered list of groups
 * @param  {String}     type   Groups list filter, 'owning' or 'participating'
 * @example
 * wa.requestGroupList();
 * wa.on('group.list', function(list) {
 * 	// every object in list has groupId, subject, creationTime properties
 * });
 */
WhatsApi.prototype.requestGroupList = function(type) {
	type = type || 'participating';

	var listNode = new protocol.Node(type);

	var attributes = {
		id    : this.nextMessageId('getgroups'),
		type  : 'get',
		to    : this.config.gserver,
		xmlns : 'w:g2'
	};

	this.sendNode(new protocol.Node('iq', attributes, [listNode]));
};

/**
 * Creates a new group
 * @param  {String} subject   The subject/topic of the group
 * @param  {Array}  contacts  An array of phone numbers to be added as participants to the group
 * @example
 * wa.createGroup('Group name', '39xxxxxxxxxx');
 * // or
 * wa.createGroup('Group name', ['39xxxxxxxxxx', '31xxxxxxxxxx']);
 */
WhatsApi.prototype.createGroup = function(subject, contacts) {
	if (!util.isArray(contacts)) {
		contacts = [contacts];
	};
	
	var participants = [];
	for (var i = 0; i < contacts.length; i++) {
		participants.push(
			new protocol.Node(
				'participant',
				{
					jid: this.createJID(contacts[i])
				}
			)
		);
	};
	
	var node = new protocol.Node(
		'iq',
		{
			xmlns : 'w:g2',
			id    : this.nextMessageId('creategroup'),
			type  : 'set',
			to    : this.config.gserver
		},
		[
			new protocol.Node(
				'create',
				{
					subject : subject
				},
				participants
			)
		]);

	this.sendNode(node);
};

/**
 * Add new participants to the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to add
 */
WhatsApi.prototype.addGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'add');
};

/**
 * Remove participants from the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to remove
 */
WhatsApi.prototype.removeGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'remove');
};

/**
 * Promote participants as admin of the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to promote
 */
WhatsApi.prototype.promoteGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'promote');
};

/**
 * Demote participants from being admin of the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to demote
 */
WhatsApi.prototype.demoteGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'demote');
};

/**
 * Do an `action` on the given numbers in the given group
 * @param  {String} groupId   Group ID
 * @param  {Array}  numbers   Array of numbers to be affected by the action
 * @param  {String} action    Action to execute on the numbers
 * @private
 */
WhatsApi.prototype.changeGroupParticipants = function(groupId, numbers, action) {
	if (!util.isArray(numbers)) {
		numbers = [numbers];
	}
	
	var participants = [];
	for (var i = 0; i < numbers.length; i++) {
		participants.push(
			new protocol.Node(
				'participant',
				{
					jid: this.createJID(numbers[i])
				}
			)
		);
	}
	
	var messageId = this.nextMessageId(action + '_group_participants_');
	var node = new protocol.Node(
		'iq',
		{
			id    : messageId,
			type  : 'set',
			xmlns : 'w:g2',
			to    : this.createJID(groupId)
		},
		[
			new protocol.Node(action, null, participants)
		]
	);
	
	this.sendNode(node);
};

/**
 * Request to leave groups
 * @param  {Array} groupIds    Group IDs you want to leave from the group
 */
WhatsApi.prototype.requestGroupsLeave = function(groupIds) {
	if (!util.isArray(groupIds)) {
		groupIds = [groupIds];
	}
	
	var groupNodes = [];

	for (var i = 0; i < groupIds.length; i++) {
		groupNodes.push(new protocol.Node('group', {id : this.createJID(groupIds[i])}));
	};

	var leaveNode = new protocol.Node('leave', { action : 'delete' }, groupNodes);

	var attributes = {
		id    : this.nextMessageId('leavegroups'),
		to    : this.config.gserver,
		type  : 'set',
		xmlns : 'w:g2'
	};

	this.sendNode(new protocol.Node('iq', attributes, [leaveNode]));
};

/**
 * Request info for a group
 * @param  {String}    groupId The ID of the group to request info for
 */
WhatsApi.prototype.requestGroupInfo = function(groupId) {
	var node = new protocol.Node(
		'iq',
		{
			id    : this.nextMessageId('get_groupv2_info'),
			xmlns : 'w:g2',
			type  : 'get',
			to    : this.createJID(groupId)
		},
		[
			new protocol.Node(
				'query',
				{
					request : 'interactive'
				}
			)
		]
	);

	this.sendNode(node);
};

/**
 * Update the subject for the given group
 * @param {String} groupId    The ID of the group you want to change the subject for
 * @param {String} subject    The new subject/topic text
 */
WhatsApi.prototype.setGroupSubject = function(groupId, subject) {
	var node = new protocol.Node(
		'iq',
		{
			id    : this.nextMessageId('set_group_subject'),
			type  : 'set',
			to    : this.createJID(groupId),
			xmlns : 'w:g2'
		},
		[
			new protocol.Node('subject', null, null, subject)
		]
	);
	
	this.sendNode(node);
};

/*
 *
 * END GROUPS
 *
 */

/**
 * Update privacy settings
 * @param {String} name  The name of the setting to update: 'last' for last seen, 'status', 'profile' for profile picture
 * @param {String} value The new value for the setting: 'all', 'contacts', 'none'
 */
WhatsApi.prototype.setPrivacySettings = function(name, value){
	var node = new protocol.Node('category', 
		{
			name  : name,
			value : value
		}
	);

    var attributes = {
    	to    : this.config.server,
        type  : 'set',
        xmlns : 'privacy',
        id    : this.nextMessageId('send_privacy_settings_')
    };

    var child =  new protocol.Node('privacy', null, [node]);

    this.sendNode(new protocol.Node('iq', attributes, [child]));
};

/**
 * Request privacy settings for the current user
 */
WhatsApi.prototype.requestPrivacySettings = function(){
    var attributes = {
    	to    : this.config.server,
        type  : 'get',
        xmlns : 'privacy',
        id    : this.nextMessageId('get_privacy_settings_')
    };

    var child =  new protocol.Node('privacy');

    this.sendNode(new protocol.Node('iq', attributes, [child]));
};

/**
 * Set current logged in user status
 * @param {String} status The new status message
 */
WhatsApi.prototype.setStatus = function(status){
    var child = new protocol.Node('status', null, null, status);

    var attributes = {
    	to    : this.config.server,
        type  : 'set',
        id    : this.nextMessageId('sendstatus'),
        xmlns : 'status'
    };

    this.sendNode(new protocol.Node('iq', attributes, [child]));
};

/**
 * Request status for the given number
 * @param  {String} number Phone number
 */
WhatsApi.prototype.requestStatus = function(number) {
	this.requestStatuses([number]);
};

/**
 * Request statuses for the given array of phone numbers
 * @param {Array} numbers   Array of phone numbers
 */
WhatsApi.prototype.requestStatuses = function(numbers){
	// String to Array, just in case
	if (!util.isArray(numbers)) {
		numbers = [numbers];
	}
	
	var contacts = [];

	for (var i = 0; i < numbers.length; i++) {
		var userNode = new protocol.Node(
			'user',
			{
				jid : this.createJID(numbers[i]),
			}
		);
		contacts.push(userNode);
	}

    var attributes = {
    	to    : this.config.server,
        type  : 'get',
        xmlns : 'status',
        id    : this.nextMessageId('getstatus')
    };

    var node = new protocol.Node(
    	'iq',
    	attributes,
    	[
    		new protocol.Node('status', null, contacts)
    	]
    );

    this.sendNode(node);
};

/**
 * Request last seen time for given user
 * @param {String}   who       Phone number
 * @param {Function} callback  Called when the last seen time is received
 */
WhatsApi.prototype.requestLastSeen = function(who, callback) {
	var messageId = this.nextMessageId('lastseen');
	this.addCallback(messageId, callback);
	
	
	var queryNode = new protocol.Node('query');

	var attributes = {
		to   : this.createJID(who),
		type : 'get',
		id   : messageId,
		xmlns: 'jabber:iq:last'
	};

	this.sendNode(new protocol.Node('iq', attributes, [queryNode]));
};

/**
 * Request subscription to presence of the given user
 * @param  {String} who    Phone number
 */
WhatsApi.prototype.sendPresenceSubscription = function(who) {
	var attributes = {
		type : 'subscribe',
		to : this.createJID(who)
	};
	var node = new protocol.Node('presence', attributes);
	
	this.sendNode(node);
};

/**
 * Requst unsubscription to presence for the given user
 * @param  {String} who    Phone number
 */
WhatsApi.prototype.sendPresenceUnsubscription = function(who) {
	var attributes = {
		type : 'unsubscribe',
		to : this.createJID(who)
	};
	var node = new protocol.Node('presence', attributes);
	
	this.sendNode(node);
};

/**
 * Requests contacts sync
 * @param {Array}   contacts    Array of contacts to be synced; single string phone number is accepted
 * @param {String}  mode        The sync mode. 'full' or 'delta'
 * @param {String}  context     The sync context. 'registration' or 'background' (more info in the wiki)
 * @param {SyncCallback} callback    Called when sync results are ready
 */
WhatsApi.prototype.requestContactsSync = function(contacts, mode, context, callback) {
	if (!util.isArray(contacts)) {
		contacts = [contacts];
	}
	
	mode = mode || 'full';
	context = context || 'registration';
	
	// Create user nodes
	var users = [];
	for (var i = 0; i < contacts.length; i++) {
		var number = contacts[i];
		// Fix numbers without leading '+'
		number = '+' + number.replace('+', '');
		
		users.push(new protocol.Node('user', null, null, number));
	};
	
	var id = this.nextMessageId('sendsync_');
	this.addCallback(id, callback);
	
	var node = new protocol.Node(
		'iq',
		{
			type: 'get',
			id: id,
			xmlns: 'urn:xmpp:whatsapp:sync'
		},
		[ new protocol.Node(
			'sync',
			{
				mode: mode,
				context: context,
				sid: common.winTimestamp().toString(),
				index: '0',
				last: 'true'
			},
			users,
			null
		) ],
		null
	);
	
	this.sendNode(node);
};

/**
 * Request WhatsApp server properties
 * @param  {Function} callback Called when the properties are received
 */
WhatsApi.prototype.requestServerProperties = function(callback) {
	var messageId = this.nextMessageId('getproperties');
	this.addCallback(messageId, callback);
	
	var node = new protocol.Node(
		'iq',
		{
			id    : messageId,
			type  : 'get',
			xmlns : 'w',
			to    : this.config.server
		},
		[
			new protocol.Node('props')
		]
	);
	
	this.sendNode(node);
};

/**
 * Request WhatsApp service pricing
 * @param {String}    language    Language code (e.g. 'en')
 * @param {String}    country     Country code (e.g. 'us')
 * @param {PricingCallback}  callback    Called when the pricing is recived
 */
WhatsApi.prototype.requestServicePricing = function(language, country, callback) {	
	var messageId = this.nextMessageId('get_service_pricing_');
	this.addCallback(messageId, callback);
	
	var node = new protocol.Node(
		'iq',
		{
			id    : messageId,
			xmlns : 'urn:xmpp:whatsapp:account',
			type  : 'get',
			to    : this.config.server
		},
		[
			new protocol.Node('pricing', { lg: language || 'en', lc: country || 'us' })
		]
	);
	
	this.sendNode(node);
};

/**
 * Extend account by one year from now
 */
WhatsApi.prototype.requestExtendAccount = function() {	
	var node = new protocol.Node(
		'iq',
		{
			id    : this.nextMessageId('extend_account_'),
			xmlns : 'urn:xmpp:whatsapp:account',
			type  : 'set',
			to    : this.config.server
		},
		[
			new protocol.Node('extend')
		]
	);
	
	this.sendNode(node);
};

/**
 * Set a new profile picture for the active account
 *
 * @param {String} filepath - Path or URL to a valid JPEG image. Do not use a large image because we can only send a max of approx. 65.000 bytes and that includes the generated thumbnail.
 * @fires mediaError
 * @example
 * //sets a random image as profile picture. Image is retrieved from lorempixel.com
 * wa.setProfilePicture('http://lorempixel.com/400/400/?.jpg');
 */
WhatsApi.prototype.setProfilePicture = function(filepath) {
	var pictureNode, thumbNode;
	var attributes = {
		id: this.nextMessageId('setphoto'),
		to: this.createJID(this.config.msisdn),
		type: 'set',
		xmlns:'w:profile:picture'
	};

	var onThumbReady = function(err, data) {
		//data is returned as a base64 string
		if(err) {
			/**			
			 * Is fired when an error occured in handling media
			 *  
			 * @event mediaError
			 * @type {Object}
			 * @property {Object} err 
			 */			
			this.emit('mediaError', err);
			return;
		}
		thumbNode = new protocol.Node('picture', {type:'preview'}, null, new Buffer(data, 'base64'));
		this.sendNode(new protocol.Node('iq', attributes, [pictureNode, thumbNode]));
	}.bind(this);

	this.getMediaFile(filepath, MediaType.IMAGE, function(err, path) {
		if(err) {
			this.emit('mediaError', err);
			return;
		}
		
		fs.readFile(path, function(err, data) {
				if(err) {
					this.emit('mediaError', err);
					return;
				}
				pictureNode = new protocol.Node('picture', null, null, data); 
				this.createImageThumbnail(path, onThumbReady);
		}.bind(this));
		
	}.bind(this));
};

/**
 * requestProfilePicture - Send a request for the profile picture for the specified account
 * 
 * When received from server a profile.picture event is fired
 * When profile picture can not be retrieved an error 404 item-not-found is returned
 * @param {String} target - Phonenumber of the account to request profile picture from
 * @param {Boolean} small - true for thumbnail, false for full size profile picture
 * @example
 * //request full size profile picture from 49xxxxxxxx
 * wa.requestProfilePicture('49xxxxxxxx', false);
 * wa.on('profile.picture', function(from,isPreview,pictureData){
 *   fs.writeFile('whatsapi/media/profilepic-'+from+'.jpg', pictureData); 
 * });
 */
WhatsApi.prototype.requestProfilePicture = function(target, small) {
	var picAttributes = {
		type  : 'image'
	};

	if(small) {
		picAttributes['type'] = 'preview';
	}

	var pictureNode = new protocol.Node('picture', picAttributes);

	var attributes = {
		id   : this.nextMessageId('profilepicture'),
		type : 'get',
		to   : this.createJID(target),
		xmlns : 'w:profile:picture'
	};

	this.sendNode(new protocol.Node('iq', attributes, [pictureNode]));
};

WhatsApi.prototype.sendMessageNode = function(to, node, msgid) {
	if(!this.loggedIn) {
		this.queue.push({to : to, node : node});
		return;
	}

	var attributes = {
		to   : this.createJID(to),
		type : (node.tag() === 'body' ? 'text' : 'media'),
		id   : msgid || this.nextMessageId('message'),
		t    : common.tstamp().toString()
	};

	var messageNode = new protocol.Node('message', attributes, [node]);

	this.sendNode(messageNode);
};

WhatsApi.prototype.flushQueue = function() {
	var queue  = this.queue;
	this.queue = [];

	queue.forEach(function(elem) {
		this.sendMessageNode(elem.to, elem.node);
	}, this);
};

WhatsApi.prototype.sendNode = function(node) {
	node && this.send(this.writer.node(node));
};

WhatsApi.prototype.send = function(buffer) {
	this.transport.send(buffer);
};

/**
 * Process incoming node
 * @param  {Node} node    Node to parse
 * @private
 */
WhatsApi.prototype.processNode = function(node) {
	if (node.isError()) {
		var error = node.child('error');
		this.emit('responseError', error.attribute('code'), error.attribute('text'));
		
		return;
	}
	
	// Got new message, send a 'receipt' node
	if (node.shouldBeReplied() && node.attribute('from') !== this.selfAddress) {
		this.sendNode(this.createReceiptNode(node));
	}
	
	if (node.isNotification()) {
		this.sendNode(this.createNotificationAckNode(node));
	}
	
	// Client received the message
	if (node.isReceipt()) {
		// Reply with ack
		this.sendNode(this.createAckNode(node));
		
		var type = node.attribute('type') || 'received';
		var from = node.attribute('from');
		var time = node.attribute('time');
		
		var messageIds = [];
		
		// Main ID
		var id = node.attribute('id');
		messageIds.push(id);
		
		// Other IDs
		if (node.child('list')) {
			var list = node.child('list');
			for (var i = 0; i < list.children().length; i++) {
				messageIds.push(list.child(i).attribute('id'));
			}
		}
		
		for (var i = 0; i < messageIds.length; i++) {
			var id = messageIds[i];
			/**
			 * 
			 * Emitted when a client received your message
			 * 
			 * @event clientReceived
			 * @type  {Object}
			 * @param {String} from    The JID of the user who received the message
			 * @param {String} id      The ID of the received message
			 * @param {String} type    Event type: 'received' or 'read'
			 * @param {Number} time    The event UNIX timestamp
			 */
			this.emit('clientReceived', from, id, type, time);
		}
		
		return;
	}
	
	// Server received the message
	if (node.isAck()) {
		/**
		 * 
		 * Emitted when the server received your sent message
		 * 
		 * @event serverReceived
		 * @type {Object}
		 * @param {String} from      The JID of the recipient
		 * @param {String} id        The message ID
		 * @param {String} class
		 * @param {Number} time      The event UNIX timestamp
		 * 
		 */
		this.emit('serverReceived',
			node.attribute('from'),
			node.attribute('id'),
			node.attribute('class'),
			node.attribute('t')
		);
		
		return;
	}

	// Authentication
	if(node.isChallenge()) {
		this.sendNode(this.createAuthResposeNode(node.data()));
		this.reader.setKey(this.readerKey);
		this.writer.setKey(this.writerKey);
		return;
	}

	// Successfully logged in
	if(node.isSuccess()) {
		fs.writeFile(this.config.challenge_file, node.data());
		
		//this.initKeys(node.data());
		//this.reader.setKey(this.readerKey);
		this.writer.setKey(this.writerKey);
		
		this.loggedIn = true;
		this.flushQueue();
		this.emit('login');
		this.loginCallback && this.loginCallback();
		return;
	}
	
	// Login failed
	if(node.isFailure()) {
		this.loggedIn = false;
		this.emit('error', node.toXml());
		this.loginCallback && this.loginCallback(node.toXml());
		return;
	}
	
	// Messages offline count
	if (node.isOfflineCount()) {
		/**
		 * Emitted when the count of messages received while offline is received
		 *
		 * @event offlineCount
		 * @param {Number} count    Count of messages/notifications
		 */
		this.emit('offlineCount', +node.child('offline').attribute('count'));
	}
	
	// Contact presence update
	if(node.isPresence() && node.attribute('from') != this.selfAddress) {
		var type = node.attribute('type') || 'available';
		this.emit('presence', node.attribute('from'), type, node.attribute('last'));
		return;
	}
	
	if(node.isDirtyPresence()) {
		this.sendNode(this.createClearDirtyNode(node));
		return;
	}
	
	// Last seen -- found
	if(node.isLastSeen()) {
		var tstamp = Date.now() - (+node.child('query').attribute('seconds')) * 1000;
		/**
		 * Is fired when a postive response is received to a "last seen" request
		 * 
		 * @event lastSeenFound
		 * @type {object}
		 * @property {LastSeen} lastSeen lastSeen object
		 */
		this.emit('lastSeenFound', {
				from : node.attribute('from'), 
				date : new Date(tstamp)
			});
		return;
	}
	/**
	 * @typedef LastSeen
	 * @type {Object}
	 * @property {String} from       Address of the "last seen" request
	 * @property {Date}   date       Last seen date/time
	 */

	/**
	* Is fired when a "last seen" date/time is not available
	* 
	* @event lastSeenNotFound
	* @type {object}
	* @property {String} from Address of the "last seen" request
	*/
	if(node.isNotFound()) {
		this.emit('lastSeenNotFound', node.attribute('from'));
		return;
	}
	
	// Ping/pong
	if(node.isPing()) {
		this.sendNode(this.createPongNode(node.attribute('id')));
		return;
	}

	// Groups query list response
	if (node.isGroupList()) {
		var groupList = [];
		var groupsNode = node.child('groups');
		for (var i = 0; i < groupsNode.children().length; i++) {
			groupList.push({
				groupId      : groupsNode.child(i).attribute('id'),
				subject      : groupsNode.child(i).attribute('subject'),
				creationTime : groupsNode.child(i).attribute('creation')
			});
		};

		this.emit('groupList', groupList);
		return;
	}
	
	// New group created
	if (node.isGroupAdd()) {
		var groupId = node.child('group').attribute('id');
		var subject = node.child('group').attribute('subject');
		var creationTs = node.child('group').attribute('creation');
		
		this.emit('groupCreated', { groupId: groupId, subject: subject, creationTime: creationTs });
		
		return;
	}
	
	// Group info + participants
	if (node.isGroupInfo()) {
		var groupNode = node.child('group');
		
		var group = {
			id       : groupNode.attribute('id'),
			creator  : groupNode.attribute('creator'),
			creation : groupNode.attribute('creation'),
			subject  : groupNode.attribute('subject'),
			participants : groupNode.children().map(function(p) {
				return {
					admin : p.attribute('type') == 'admin' ? true : false,
					jid   : p.attribute('jid')
				}
			})
		};
		
		this.emit('groupInfo', group);
		
		return;
	}
	
	// Added/removed/promoted/demoted group participants
	if (node.isChangeGroupParticipants()) {
		var action = node.child(0).tag();
		var who = node.child(0).children().map(function(p) {
			return {
				jid   : p.attribute('jid'),
				error : p.attribute('error') || ''
			}
		});
		var messageId = node.attribute('id');
		
		/**
		 * Emitted when group participants have changed
		 * @event changedGroupParticipants
		 * @param {String} action     Action performed ('add', 'remove', 'promote', 'demote')
		 * @param {Array}  who        Array of objects containing JID and eventual error
		 * @param {String} messageId
		 */
		this.emit('groupChangedParticipants', action, who, messageId);
		
		return;
	}
	
	if (node.isLeaveGroup()) {
		var jids = node.child(0).children().map(function(g) {
			return g.attribute('id')
		});
		var messageId = node.attribute('id');
		
		/**
		 * Emitted when you left a group
		 * @event groupLeave
		 * @param {Array}  jids        Array of group JIDs you left
		 * @param {String} messageId
		 */
		this.emit('groupLeave', jids, messageId);
		
		return;
	}
	
	
	if(node.isMediaReady()) {
		this.createMediaUploadNode(node, function(err, to, node) {
			if(err) {
				this.emit('mediaError', err);
				return;
			}

			this.sendMessageNode(to, node);
		}.bind(this));
		return;
	}

	if(node.isProfilePicture()) {
		var preview = node.child('picture').attribute('type') === 'preview';
		
		/**
		 * Is fired when a requested profile picture is received
		 * 
		 * @event profilePictureReceived
		 * @type {object}
		 * @property {ProfilePicture} profilePicture ProfilePicture object
		 * @example
		 * wa.on('profilePictureReceived', function(profilePicture){
		 *   console.log("profilePictureReceived event fired:\n from: %s\n isPreview: %s\n pictureDate length: %d", profilePicture.from, profilePicture.isPreview, profilePicture.pictureData.length);
		 *   fs.writeFile('whatsapi/media/profilepic-'+profilePicture.from+(profilePicture.isPreview?'-preview':'-full')+'.jpg', profilePicture.pictureData); 
		 * });
		 */
		this.emit('profilePictureReceived', {
				from        : node.attribute('from'), 
				isPreview   : preview, 
				pictureData : node.child('picture').data(),
				pictureId   : node.child('picture').attribute('id')

			});
		return;
	}
	/**
	 * @typedef ProfilePicture
	 * @type {Object}
	 * @property {String}  from        JID of the users the profile picture belongs to
	 * @property {Boolean} isPreview   Is this a preview (true) or the full picture (false)
	 * @property {Buffer}  pictureData Raw picture data
	 * @property {Number}  pictureId   ID from this picture
	 */
	
	// User statuses
	if (node.isGetStatus()) {
		var statusNode = node.child('status');
		var statuses = [];
		
		for (var i = 0; i < statusNode.children().length; i++) {
			statuses.push({
				from   : statusNode.child(i).attribute('jid'),
				status : statusNode.child(i).data().toString('utf8'),
				date   : new Date(+statusNode.child(i).attribute('t') * 1000)
			});
		};
		
		/**
		 * Is fired when a response to a status request is received
		 * 
		 * @event statusReceived
		 * @type {object}
		 * @property {Status[]} statuses An array of status responses
		 */
		this.emit('statusReceived', statuses);
		
		return;
	}
	/**
	 * @typedef Status
	 * @type {Object}
	 * @property {String}  from     JID of the users the status belongs to
	 * @property {String}  status   The status message
	 * @property {Date}    date     Date of the creation of the status message
	 */

	// Set new status response
	if (node.isSendStatus()) {
		/**
		 * Is fired when the status update was successful
		 * 
		 * @event statusUpdated
		 * @type {object}
		 */
		this.emit('statusUpdated');
		return;
	};
	
	// Incoming plain message
	if(node.isMessage()) {
		// Emit stopped typing
		if (node.attribute('type') == 'text') {
			this.emit('typing', 'paused', node.attribute('from'), node.attribute('participant') || '');
		}		
		// Process message
		this.processor.process(node);
		return;
	}
	
	// Emit typing (composing or paused)
	if(node.isTyping()) {
		var from = node.attribute('from');
		var type = node.child(0).tag();
		var author = node.attribute('participant') || '';
		
		/**
		 * Emitted when a contact is writing or stopped writing a message
		 * @event typing
		 * @param {String} type    'composing' or 'paused'
		 * @param {String} from    Contact or group JID
		 * @param {String} author  If `from` is a group, the actual contact JID
		 */
		this.emit('typing', type, from, author);
		
		return;
	}
	
	// Sync response
	if (node.isSync()) {		
		var sync = node.child('sync');
		var existing = sync.child('in');
		var nonExisting = sync.child('out');
		var invalid = sync.child('invalid');
		
		var existingUsers = [];
		if (existing) {
			for (var i = 0; i < existing.children().length; i++) {
				existingUsers.push(existing.child(i).data().toString());
			}
		}
		
		var nonExistingUsers = [];
		if (nonExisting) {
			for (var i = 0; i < nonExisting.children().length; i++) {
				nonExistingUsers.push(nonExisting.child(i).data().toString());
			}
		}
		
		var invalidNumbers = [];
		if (invalid) {
			for (var i = 0; i < invalid.children().length; i++) {
				invalidNumbers.push(invalid.child(i).data().toString());
			}
		}
		
		var result = {
			existingUsers    : existingUsers,
			nonExistingUsers : nonExistingUsers,
			invalidNumbers   : invalidNumbers
		};
		this.executeCallback(node.attribute('id'), result);
		
		return;
	}
	/**
	 * @callback SyncCallback
	 * @param {ContactsSync} result
	 */
	
	/**
	 * @typedef ContactsSync
	 * @type {Object}
	 * @property {Array}  existingUsers       An array of numbers of users that have a WhatsApp account
	 * @property {Array}  nonExistingUsers    An array of numbers of users that don't have a WhatsApp account
	 * @property {Array}  invalidNumbers      An array of numbers that are invalid according to WhatsApp
	 */
	
	// Server properties response
	if (node.isProperties()) {
		var properties = {};
		
		var propElements = node.child('props').children();
		for (var i = 0; i < propElements.length; i++) {
			properties[propElements[i].attribute('name')] = propElements[i].attribute('value');
		}
		
		this.executeCallback(node.attribute('id'), properties);
		return;
	}
	
	// Service pricing response
	if (node.isServicePricing()) {
		var pricingNode = node.child('pricing');
		
		var pricing = {
			price: pricingNode.attribute('price'),
			cost: pricingNode.attribute('cost'),
			currency: pricingNode.attribute('currency'),
			expiration: new Date(+pricingNode.attribute('expiration') * 1000)
		};
		
		this.executeCallback(node.attribute('id'), pricing);
		return;
	}
	/**
	 * @callback PricingCallback
	 * @param {ServicePricing} pricing
	 */
	/**
	 * @typedef {ServicePricing}
	 * @property {String} price       Price with currency symbol
	 * @property {String} cost        Price number
	 * @property {String} currency    Currency as string
	 * @property {String} expiration  Expiration date of the pricing
	 */
	
	// Get privacy settings
	if (node.isGetPrivacySettings()) {
		var privacyNode = node.child('privacy');
		
		var settings = {};
		for (var i = 0; i < privacyNode.children().length; i++) {
			var s = privacyNode.child(i);
			settings[s.attribute('name')] = s.attribute('value');
		};
		
		this.emit('privacySettings', settings);
		return;
	}
	
	// Set privacy settings
	if (node.isSendPrivacySettings()) {
		var privacyNode = node.child('privacy');
		
		var settings = {};
		for (var i = 0; i < privacyNode.children().length; i++) {
			var s = privacyNode.child(i);
			settings[s.attribute('name')] = s.attribute('value');
		};
		
		this.emit('privacySettingsUpdated', settings);
		return;
	}
	
	if (node.isAccountExtended()) {
		var accountNode = node.child('extend').child('account');
		
		var accountInfo = {
			kind: accountNode.attribute('kind'),
			status: accountNode.attribute('status'),
			creation: new Date(+accountNode.attribute('creation') * 1000),
			expiration: new Date(+accountNode.attribute('expiration') * 1000)
		};
		
		this.emit('accountExtended', accountInfo);
		
		return;
	}
};

WhatsApi.prototype.createFeaturesNode = function() {
	var features = [
		new protocol.Node('readreceipts'),
		new protocol.Node('groups_v2'),
		new protocol.Node('privacy'),
		new protocol.Node('presence')
	];

	return new protocol.Node('stream:features', null, features);
};

WhatsApi.prototype.createAuthNode = function() {
	var attributes = {
		//xmlns     : 'urn:ietf:params:xml:ns:xmpp-sasl',
		mechanism : 'WAUTH-2',
		user      : this.config.msisdn
	};

	return new protocol.Node('auth', attributes, null, this.createAuthData());
};

WhatsApi.prototype.createAuthData = function() {
	var challenge = fs.readFileSync(this.config.challenge_file);

	if(!challenge.length) {
		return '';
	}

	//this.initKeys(challenge);
	var key = encryption.pbkdf2(new Buffer(this.config.password, 'base64'), challenge, 16, 20);
	this.readerKey = new encryption.KeyStream(new Buffer([key[2]]), new Buffer([key[3]]));
	this.writerKey = new encryption.KeyStream(new Buffer([key[0]]), new Buffer([key[1]]));


	this.reader.setKey(this.readerKey);

	var arr = Buffer.concat([
		new Buffer([0,0,0,0]),
		new Buffer(this.config.msisdn),
		challenge,
		new Buffer(common.tstamp().toString()),
		new Buffer(this.config.ua),
		new Buffer(' MccMnc/' + this.config.ccode + '001')
	]);
	return this.writerKey.encodeMessage(arr, 0, arr.length, 0);
};

WhatsApi.prototype.createAuthResposeNode = function(challenge) {
  //console.log(challenge.toString('hex'));
	this.initKeys(challenge);

	var arr = Buffer.concat([
		new Buffer([0,0,0,0]),
		new Buffer(this.config.msisdn),
		challenge
	]);
	//console.log(arr.toString('hex'));
	var data = this.writerKey.encodeMessage(arr, 0,4,arr.length -4);
  //console.log(data.toString('hex'));
	return new protocol.Node('response', {xmlns : 'urn:ietf:params:xml:ns:xmpp-sasl'}, null, data);
};

WhatsApi.prototype.generateKeys = function(password, nonce) {
	var keys = [];
	for(var j=1;j<5;j++){
		var currNonce = Buffer.concat( [nonce, new Buffer([j])] );
		keys.push( encryption.pbkdf2(new Buffer(password, 'base64'), currNonce, 2, 20) );		
	}
	return keys;
};

WhatsApi.prototype.initKeys = function(nonce) {
	var keys = this.generateKeys(this.config.password, nonce);

	this.readerKey = new encryption.KeyStream(keys[2], keys[3]);
	this.writerKey = new encryption.KeyStream(keys[0], keys[1]);
};

WhatsApi.prototype.createClearDirtyNode = function(node) {
	var categories = [];

	var children = node.children();
	if(children.length) {
		for (var i = 0; i < children.length; i++) {
			var child = node.child(i);
			if(child.tag() === 'category') {
				categories.push(new protocol.Node('category', {name : child.attribute('name')}));
			}
		};
	}

	var cleanNode = new protocol.Node('clean', {xmlns : 'urn:xmpp:whatsapp:dirty'}, categories);

	var attributes = {
		id   : this.nextMessageId('cleardirty'),
		type : 'set',
		to   : this.config.server
	};

	return new protocol.Node('iq', attributes, [cleanNode]);
};

/**
 * Create a pong node, to be sent in response to ping
 * @param  {String} messageId    The ping message ID
 * @return {Node}       Created node
 */
WhatsApi.prototype.createPongNode = function(messageId) {
	var attributes = {
		to   : this.config.server,
		id   : messageId,
		type : 'result'
	};

	return new protocol.Node('iq', attributes);
};

/**
 * Create a 'receipt' node, to be sent when a new message is received/read
 * @param  {Node} node    The received message node
 * @return {Node}         Created node
 */
WhatsApi.prototype.createReceiptNode = function(node) {
	var attributes = {
		to   : node.attribute('from'),
		type : 'read',
		id   : node.attribute('id'),
		t    : common.tstamp().toString()
	};
	
	if (node.attribute('participant')) {
		attributes['participant'] = node.attribute('participant');
	}

	return new protocol.Node('receipt', attributes);
};

/**
 * Create a 'ack' node, to be sent when a new notification is received
 * @param  {Node} node    The notification node
 * @return {Node}         Created node
 */
WhatsApi.prototype.createNotificationAckNode = function(node) {
	var attributes = {
		to    : node.attribute('from'),
		class : 'notification',
		id    : node.attribute('id'),
		type  : node.attribute('type')
	};
	if (node.attribute('to')) {
		attributes['from'] = node.attribute('to');
	}
	if (node.attribute('participant')) {
		attributes['participant'] = node.attribute('participant');
	}

	return new protocol.Node('ack', attributes);
};

/**
 * Create a 'ack' node, to be sent when a 'receipt' node is received
 * @param  {Node} node     The 'receipt' node
 * @return {Node}          Created node
 */
WhatsApi.prototype.createAckNode = function(node) {
	var attributes = {
		to   : node.attribute('from'),
		id   : node.attribute('id'),
		t    : common.tstamp().toString()
	};
	
	// Ack type --> nothing or 'read'
	if (node.attribute('type')) {
		attributes['type'] = node.attribute('type');
	}
	
	var node = new protocol.Node(
		'ack',
		attributes
	);
	
	return node;
};

WhatsApi.prototype.createRequestMediaUploadNode = function(filehash, filetype, filesize, filepath, to, caption, msgid) {
	var attributes = {
		hash  : filehash,
		type  : filetype,
		size  : filesize.toString()
	};

	var mediaNode = new protocol.Node('media', attributes);

	var iqAttributes = {
		id   : msgid || this.nextMessageId('upload'),
		to   : this.config.server,
		type : 'set',
		xmlns : 'w:m'
	};

	this.mediaQueue[iqAttributes.id] = {
		filepath : filepath,
		filesize : filesize,
		to       : to,
		from     : this.config.msisdn
	};
	if(caption && caption.length) this.mediaQueue[iqAttributes.id].caption = caption;

	return new protocol.Node('iq', iqAttributes, [mediaNode]);
};

WhatsApi.prototype.createMediaUploadNode = function(node, callback) {
	var id = node.attribute('id');

	if(!this.mediaQueue.hasOwnProperty(id)) {
		return;
	}

	var queued = this.mediaQueue[id];
	delete this.mediaQueue[id];

	var attributes = {
		xmlns : 'urn:xmpp:whatsapp:mms'
	};
	if (queued.caption) attributes.caption = queued.caption;

	var onAttributesReady = function(url, type, size, file) {
		attributes.url  = url;
		attributes.type = type;
		attributes.size = size;
		attributes.file = file;

		var onThumbReady = function(err, data) {
			if(err) {
				callback(err);
				return;
			}

			callback(false, queued.to, new protocol.Node('media', attributes, null, data));
		};

		if(type === MediaType.IMAGE) {
			this.createImageThumbnail(queued.filepath, onThumbReady);
			return;
		}

		if(type === MediaType.VIDEO) {
			this.createVideoThumbnail(queued.filepath, onThumbReady);
			return;
		}

		onThumbReady(false, '');
	}.bind(this);

	var duplicate = node.child('duplicate');

	if(duplicate) {
		onAttributesReady(
			duplicate.attribute('url'),
			duplicate.attribute('type'),
			duplicate.attribute('size'),
			duplicate.attribute('url').replace(/(?:.*\/|^)([^\/]+)$/, '$1')
		);
	} else {
		this.uploadMediaFile(queued, node.child('media').attribute('url'), function(err, response) {
			if(err) {
				callback(err);
				return;
			}

			onAttributesReady(response.url, response.type, response.size, response.name);
		});
	}
};

WhatsApi.prototype.getMediaFile = function(filepath, filetype, callback) {
	if(!this.mediaMimeTypes.hasOwnProperty(filetype)) {
		callback('Invalid file type: ' + filetype);
		return;
	}

	var onFileReady = function(path) {
		var mimeType = mime.lookup(path);

		if(this.mediaMimeTypes[filetype].mime.indexOf(mimeType) === -1) {
			callback('Invalid file mime type: ' + mimeType);
			return;
		}

		var fileSize = fs.statSync(path).size;
		var maxSize  = this.mediaMimeTypes[filetype].size;

		if(maxSize < fileSize) {
			callback('Media file too big (max size is ' + maxSize + ' file size is ' + fileSize + ')');
			return;
		}

		callback(false, path);
	}.bind(this);

	fs.exists(filepath, function(result) {
		if(result) {
			onFileReady(filepath);
			return;
		}

		var parsed = url.parse(filepath);

		if(!parsed.host) {
			callback('Filepath is nor url neither path to existing file');
			return;
		}

		this.downloadMediaFile(filepath, function(err, path) {
			if(err) {
				callback(err);
			} else {
				onFileReady(path);
			}
		});
	}.bind(this));
};

WhatsApi.prototype.downloadMediaFile = function(destUrl, callback) {
	var match = destUrl.match(/\.[^\/.]+$/);

	var ext = match ? match[0] : '';

	var schema = url.parse(destUrl).protocol;

	var reqObj = schema === 'https:' ? https : http;

	reqObj.get(destUrl, function(res) {
		if(res.statusCode != 200){
			if( res.statusCode == 302 && res.headers && res.headers.location){
				return this.downloadMediaFile( res.headers.location, callback);
			}
			callback('HTTP 200 or 302 reponse expected, but received: ' + res.statusCode);
		}
		
		var buffers = [];
		res.on('data', function(data) {
			buffers.push(data);
		});
		
		res.on('error', function(err){
			callback('Error downloading data: ' + err);
		});
		
		res.on('close', function(had_error){
			if(had_error){
				callback('Error occured while downloading data');
			}
		});

		res.on('end', function() {
			var filePath = path.join(__dirname, 'media', 'media-');
			filePath += crypto.randomBytes(4).readUInt32LE(0) + ext;

			fs.writeFile(filePath, Buffer.concat(buffers), function(err) {
				if(err) {
					callback('Error saving downloaded file: ' + err);
				} else {
					callback(null, filePath);
				}
			});
		});
	}.bind(this)).on('error', function(e) {
		callback('HTTP error: ' + e.message);
	});
};

WhatsApi.prototype.uploadMediaFile = function(queue, destUrl, callback) {
	var type       = mime.lookup(queue.filepath);
	var ext        = mime.extension(type);
	var boundary   = 'zzXXzzYYzzXXzzQQ';
	var filename   = crypto.createHash('md5').update(queue.filepath).digest('hex') + '.' + ext;
	var host       = url.parse(destUrl).hostname;
	var contentLen = 0;

	var post = [
		'--' + boundary,
		'Content-Disposition: form-data; name="to"\r\n',
		this.createJID(queue.to),
		'--' + boundary,
		'Content-Disposition: form-data; name="from"\r\n',
		queue.from,
		'--' + boundary,
		'Content-Disposition: form-data; name="file"; filename="' + filename + '"',
		'Content-Type: ' + type + '\r\n'
	];

	var end = '\r\n--' + boundary + '--\r\n';

	post.forEach(function(str) {
		contentLen += str.length + 2;
	});

	contentLen += queue.filesize + end.length;

	var headers = [
		'POST ' + destUrl,
		'Content-Type: multipart/form-data; boundary=' + boundary,
		'Host: ' + host,
		'User-Agent: ' + this.config.ua,
		'Content-Length: ' + contentLen + '\r\n'
	];

	var options = {
		port : 443,
		host : host,
		rejectUnauthorized : false
	};

	var tlsStream = tls.connect(options, function() {
		headers.forEach(function(str) {
			tlsStream.write(str + '\r\n');
		});

		post.forEach(function(str) {
			tlsStream.write(str + '\r\n');
		});

		var filestream = fs.createReadStream(queue.filepath);

		filestream.pipe(tlsStream, {end : false});

		filestream.on('end', function() {
			tlsStream.write(end);
		});
	});

	tlsStream.on('error', function(err) {
		this.emit('mediaError', 'SSL/TLS error: ' + err);
	}.bind(this));

	var buffers = [];

	tlsStream.on('data', function(data) {
		buffers.push(data);
	});

	tlsStream.on('end', function() {
		var result = Buffer.concat(buffers).toString();

		try {
			callback(false, JSON.parse(result.split('\r\n\r\n').pop()));
		} catch(e) {
			callback('Unexpected upload response: ' + result);
		}
	});
};

WhatsApi.prototype.createImageThumbnail = function(srcPath, callback) {
	var dstPath = srcPath.replace(/^(.*?)(\.[^.]+$|$)/, '$1-thumb$2');

	try {
		if (this.config.imageTool == ImageTools.JIMP) {
			var image = new jimp(srcPath, function() {
				try {
					// Crop
					if (this.bitmap.width > this.bitmap.height) {
						var x1 = (this.bitmap.width - this.bitmap.height) / 2;
						var x2 = this.bitmap.width - x1;
						var y1 = 0;
						var y2 = this.bitmap.height;
						
						this.crop(x1, y1, x2, y2);
					}
					else if (this.bitmap.height > this.bitmap.width) {
						var x1 = 0;
						var x2 = this.bitmap.width;
						var y1 = (this.bitmap.height - this.bitmap.width) / 2;
						var y2 = this.bitmap.height - y1;
						
						this.crop(x1, y1, x2, y2);
					}
					
					this.quality(80);
					this.resize(200, 200);
					this.getBuffer(mime.lookup(srcPath), function(buffer) {
						callback(false, buffer.toString('base64'));
					});
					this.write(dstPath); // save, just for log
				}
				catch (e) {
					callback(e.message);
				}
			});
		}
		else {
			if (this.config.imageTool == ImageTools.IMAGEMAGICK) {
				var options = { imageMagick: true };
			}
			else if (this.config.imageTool == ImageTools.GRAPHICSMAGICK) {
				var options = { imageMagick: false };
			}
			else {
				callback('Invalid image tool');
				return;
			}
			
			// Correct configuration from http://stackoverflow.com/a/25083756/1633924
			gm(srcPath)
				.options(options)
				.quality(80)
				.resize(200, 200, '^')
				.gravity('Center')
				.crop(200, 200)
				.toBuffer(function(err, buffer) {
					if (err) callback(err);
					callback(false, buffer.toString('base64'));
				})
				.write(dstPath, function() {});
		}
	} catch(e) {
		callback(e.message);
	}
};

WhatsApi.prototype.createVideoThumbnail = function(srcPath, callback) {
	callback(false, '/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABQAAD/4QMpaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjAtYzA2MCA2MS4xMzQ3NzcsIDIwMTAvMDIvMTItMTc6MzI6MDAgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzUgV2luZG93cyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo2MTQyRUVCOEI3MDgxMUUyQjNGQkY1OEU5M0U2MDE1MyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDo2MTQyRUVCOUI3MDgxMUUyQjNGQkY1OEU5M0U2MDE1MyI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjYxNDJFRUI2QjcwODExRTJCM0ZCRjU4RTkzRTYwMTUzIiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjYxNDJFRUI3QjcwODExRTJCM0ZCRjU4RTkzRTYwMTUzIi8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+/+4ADkFkb2JlAGTAAAAAAf/bAIQAAgICAgICAgICAgMCAgIDBAMCAgME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');
};

/**
 * Generate the next ID for outcoming messages
 * @param  {String} prefix    The ID prefix
 * @return {String}           Message ID
 */
WhatsApi.prototype.nextMessageId = function(prefix) {
	return [prefix, common.tstamp(), ++this.messageId].join('-');
};

/**
 * Create the JID for the given number
 * @param  {String} msisdn    Phone number
 * @return {String}           The JID
 */
WhatsApi.prototype.createJID = function(msisdn) {
	msisdn = msisdn.toString();
	if(msisdn.indexOf('@') !== -1) {
		return msisdn;
	}

	var affix = msisdn.indexOf('-') === -1 ? this.config.server : this.config.gserver;

	return msisdn + '@' + affix;
};

WhatsApi.prototype.onTransportConnect = function() {
	this.emit('connect');
	this.connectCallback && this.connectCallback();
	this.connected = true;
};

WhatsApi.prototype.onTransportError = function(e) {
	this.connectCallback && this.connectCallback(e);
	this.emit(this.connected ? 'error' : 'connectError', e);
};

WhatsApi.prototype.onTransportEnd = function() {
	this.connected = false;
	if(this.config.reconnect) {
		this.emit('reconnect');
		this.connect();
	} else {
		this.emit('end');
	}
};

WhatsApi.prototype.onTransportData = function(data) {
	this.reader.appendInput(data);

	while(true) {
		var node = this.reader.nextNode();

		if(node === false) {
			break;
		}

		if(node) {
			this.processNode(node);
		}
	}
};

/**
* @class WhatsApiDebug
* @augments WhatsApi
* @param {WhatsApiConfig} config
* @param {Reader}         reader
* @param {Writer}         writer
* @param {Processor}      processor
* @param {Transport}      transport
*/
function WhatsApiDebug() {
	WhatsApiDebug.super_.apply(this, arguments);
}

util.inherits(WhatsApiDebug, WhatsApi);


WhatsApiDebug.prototype.processNode = function(node) {
	node && console.log(node.toXml('rx '));
	return WhatsApiDebug.super_.prototype.processNode.apply(this, arguments);
};

WhatsApiDebug.prototype.sendNode = function(node) {
	node && console.log(node.toXml('tx '));
	return WhatsApiDebug.super_.prototype.sendNode.apply(this, arguments);
};

function createAdapter(config, debug, reader, writer, processor, transport) {
	reader    = reader    || new protocol.Reader(dictionary);
	writer    = writer    || new protocol.Writer(dictionary);
	processor = processor || processors.createProcessor();
	transport = transport || new transports.Socket;

	var WhatsApp = debug ? WhatsApiDebug : WhatsApi;

	return new WhatsApp(config, reader, writer, processor, transport);
}

function createRegistration(config) {
	return new wareg.WhatsApiRegistration(config);
}

exports.createAdapter      = createAdapter;
exports.createRegistration = createRegistration;
exports.imageTools         = ImageTools;
