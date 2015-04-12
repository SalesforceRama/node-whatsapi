// Chat state submodule
// Includes functions for managing WhatsApp chat state and presence

var protocol = require('../protocol.js');
/**
 * @alias WhatsApi
 */
var WhatsApi = module.exports;

/**
 * Send online presence for the current user
 * @instance
 */
WhatsApi.sendIsOnline = function() {
	var attributes = {
		name : this.config.username
	};

	this.sendNode(new protocol.Node('presence', attributes));
};

/**
 * Send offline presence for the current user
 * @instance
 */
WhatsApi.sendIsOffline = function() {
	var attributes = {
		type : 'unavailable',
		name : this.config.username
	};

	this.sendNode(new protocol.Node('presence', attributes));
};

/**
 * Send composing state to the given user
 * @param  {String} to     Phone number
 * @instance
 */
WhatsApi.sendComposingState = function(to) {
	this.sendChatState(to, 'composing');
};

/**
 * Send stopped typing/composing to the given user
 * @param  {String} to     Phone number
 * @instance
 */
WhatsApi.sendPausedState = function(to) {
	this.sendChatState(to, 'paused');
};

/**
 * @private
 */
WhatsApi.sendChatState = function(to, state) {
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
 * Request subscription to presence of the given user
 * @param  {String} who    Phone number
 * @fires presence
 * @instance
 */
WhatsApi.sendPresenceSubscription = function(who) {
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
 * @fires presence
 * @instance
 */
WhatsApi.sendPresenceUnsubscription = function(who) {
	var attributes = {
		type : 'unsubscribe',
		to : this.createJID(who)
	};
	var node = new protocol.Node('presence', attributes);
	
	this.sendNode(node);
};
