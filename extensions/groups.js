// Groups submodule
// Includes functions for groups management

var protocol = require('../protocol.js');
/**
 * @alias WhatsApi
 */
var WhatsApi = module.exports;

/**
 * Request a filtered list of groups
 * @param  {String}     type   Groups list filter, 'owning' or 'participating'
 * @example
 * wa.requestGroupList();
 * wa.on('group.list', function(list) {
 * 	// every object in list has groupId, subject, creationTime properties
 * });
 * @instance
 */
WhatsApi.requestGroupList = function(type) {
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
 * @instance
 */
WhatsApi.createGroup = function(subject, contacts) {
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
 * @instance
 */
WhatsApi.addGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'add');
};

/**
 * Remove participants from the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to remove
 * @instance
 */
WhatsApi.removeGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'remove');
};

/**
 * Promote participants as admin of the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to promote
 * @instance
 */
WhatsApi.promoteGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'promote');
};

/**
 * Demote participants from being admin of the group
 * @param {String} groupId  Group ID
 * @param {Array}  numbers  Array of participants numbers to demote
 * @instance
 */
WhatsApi.demoteGroupParticipants = function(groupId, numbers) {
	this.changeGroupParticipants(groupId, numbers, 'demote');
};

/**
 * Do an 'action' on the given numbers in the given group
 * @param  {String} groupId   Group ID
 * @param  {Array}  numbers   Array of numbers to be affected by the action
 * @param  {String} action    Action to execute on the numbers
 * @private
 * @instance
 */
WhatsApi.changeGroupParticipants = function(groupId, numbers, action) {
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
 * @instance
 */
WhatsApi.requestGroupsLeave = function(groupIds) {
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
 * @instance
 */
WhatsApi.requestGroupInfo = function(groupId) {
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
 * @instance
 */
WhatsApi.setGroupSubject = function(groupId, subject) {
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

