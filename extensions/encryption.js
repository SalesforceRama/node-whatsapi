// Service submodule
// Includes functions for end-to-end encryption 

var util = require('util');
var path = require('path');
var crypto = require('crypto');
var axolotl = require('axolotl');
var common = require('../common');
var protocol = require('../protocol');
var ks = require('../keystore');

var WhatsApi = module.exports = function() {};

//extend buffer to be able to read 3 bytes
Buffer.prototype.readUInt24BE = function(position) {
  position = position || 0;

  return this[position] << 16 | this[++position] << 8 | this[++position] << 0;
};

Buffer.prototype.writeUInt24BE = function(uint, position) {
	position = position || 0;

	this.writeUInt8((uint & 0xff0000) >> 16, position);
	this.writeUInt8((uint & 0x00ff00) >> 8, ++position);
	this.writeUInt8((uint & 0x0000ff) >> 0, ++position);
};


WhatsApi._COUNT_PREKEYS = 200;

WhatsApi.prototype.initKeyStore = function(callback) {
  console.log("Opening (or creating) SQLite DB in " + this.keystoreFilePath);
  this.keystore = new ks.KeyStore(this.keystoreFilePath);
  
  this.keystore.init().then( function(result){
        console.log(result);
        axolotl = axolotl(this.keystore);
        
        this.emit('keystoreInitialized');
        callback && callback();
        
      }.bind(this))
      .catch( function (error){
        console.log(error);
        callback && callback(Error('Keystore not inited: '), error.stack);
      });  
};

/*
REQUEST

<iq to="s.whatsapp.net" xmlns="encrypt" type="get" id="getkey-1429304144-1">
<key>
<user jid="xxxxxxxxxxx@s.whatsapp.net">
</user>
</key>
</iq>
*/

/*
EXPECTED RESPONSE

rx <iq from="s.whatsapp.net" id="getkey-1429304144-1" type="result">
rx   <list>
rx     <user jid="xxxxxxxxxxx@s.whatsapp.net">
rx       <registration>4 data length</registration>
rx       <type>1 data length</type>
rx       <identity>32 data length</identity>
rx       <skey>
rx         <id>3 data length</id>
rx         <value>32 data length</value>
rx         <signature>64 data length</signature>
rx       </skey>
rx       <key>
rx         <id>3 data length</id>
rx         <value>32 data length</value>
rx       </key>
rx     </user>
rx   </list>
rx </iq>
*/


WhatsApi.prototype.getKeys = function(jids) {

  var messageId = this.nextMessageId();
  if (!util.isArray(jids)) {
    jids = [jids];
  }

  var users = jids.map(function(jid) {
    return new protocol.Node(
      'user',
      {
        jid: jid
      }
    );
  }, this);

  var keyNode = new protocol.Node( 'key', null , users );

  var attributes = {
    to   : this.config.server,
    xmlns: 'encrypt',
    type   : 'get',
    id : messageId
    
  };
  //store the list of requested numbers for later use.
  this.pendingGetKeyRequests[messageId] = jids;
  this.sendNode( new protocol.Node('iq', attributes, [keyNode]) );
};

// rx <iq from="s.whatsapp.net" id="getkey-xxxxxx-1" type="result">
// rx   <list>
// rx     <user jid="xxxxxxxxx@s.whatsapp.net">
// rx       <registration>4 data length</registration>
// rx       <type>1 data length</type>
// rx       <identity>32 data length</identity>
// rx       <skey>
// rx         <id>3 data length</id>
// rx         <value>32 data length</value>
// rx         <signature>64 data length</signature>
// rx       </skey>
// rx       <key>
// rx         <id>3 data length</id>
// rx         <value>32 data length</value>
// rx       </key>
// rx     </user>
// rx   </list>
// rx </iq>

  /**
   * @typedef {Object} PreKeyBundle
   * @property {ArrayBuffer} identityKey - The remote identity's public key.
   * @property {Number} preKeyId - The identifier of the pre-key included in this bundle.
   * @property {ArrayBuffer} preKey - The public half of the pre-key.
   * @property {Number} signedPreKeyId - The identifier of the signed pre-key included in this bundle.
   * @property {ArrayBuffer} signedPreKey - The public half of the signed pre-key.
   * @property {ArrayBuffer} signedPreKeySignature - The signature associated with the `signedPreKey`
   */

/**
  We don't receive any information from the server for numbers that don't have any public keys stored, so we have to keep track of these ourselves.
 */

WhatsApi.prototype.processGetKeysResponse = function(getKeysResponseNode){
  var userList = getKeysResponseNode.child('list');
  var keyBundles = [];
  var messageId = getKeysResponseNode.attribute('id');
  
  for (var i = 0; i < userList.children().length; i++) {
    var userNode = userList.child(i);
    var preKeyNode = userNode.child('key');
    var signedPreKeyNode = userNode.child('skey');
    var jid = userNode.attribute('jid');
    
    console.log('Signed PreKeyId: ', signedPreKeyNode.child('id').data());
    
    keyBundles[jid] = {
      identityKey:           common.toArrayBuffer(Buffer.concat([new Buffer([0x05]), userNode.child('identity').data()])),
      preKeyId:              preKeyNode.child('id').data().readUInt24BE(),
      preKey:                common.toArrayBuffer(Buffer.concat([new Buffer([0x05]), preKeyNode.child('value').data()])),
      signedPreKeyId:        signedPreKeyNode.child('id').data().readUInt24BE(),
      signedPreKey:          common.toArrayBuffer(Buffer.concat([new Buffer([0x05]), signedPreKeyNode.child('value').data()])),//common.toArrayBuffer(signedPreKeyNode.child('value').data()),
      signedPreKeySignature: common.toArrayBuffer(signedPreKeyNode.child('signature').data())
    };
  }
  
  var jids = this.pendingGetKeyRequests[messageId];
  delete this.pendingGetKeyRequests[messageId];
  
  jids.forEach( function(jid){

    if( keyBundles[jid] === undefined ){
      //jid not in response from server, so we have to send the message unencrypted
      this.skipEncJids[jid] = true;
      this.processPendingMessages(jid);
    }else{
      //jid is present in response, so we can build a session using the keyBundle and send an encrypted message
      axolotl.createSessionFromPreKeyBundle( keyBundles[jid] )
        .then( function(result){
          this.sessions[jid] = result;
          console.log('Got result! ', result);
          this.processPendingMessages(jid);
        }.bind(this))
        .catch( function(error){
          console.log ('Error creating session from prekeyBundle: ', error);
          console.log (error.stack);
        });
    }
  }.bind(this));
  
  console.log('keyBundles: ', keyBundles);
};

// <iq to="s.whatsapp.net" xmlns="encrypt" type="set" id="3">
//   <list>
//     <key>
//       <id>HEX:4ac708</id>
//       <value>HEX:9a5ca50f104ff84251fa4f13e95c00f4024305ce4dc0aa196abfc46fab051508</value>
//     </key>
//     <key>
//       <id>HEX:4ac709</id>
//       <value>HEX:7638bcc7d29b57d52919f186dc0a5e192db3d51c3e35e15a2e00121570dde27b</value>
//     </key>
// 
//     ...
// 
//   </list>
//   <identity>HEX:ba92b7d024da6410551773fd8b7a6e5ae55f885bbd6195a2f0ec7c380033534e</identity>
//   <registration>HEX:dfbba5b3</registration>
//   <type>HEX:05</type>
//   <skey>
//     <id>HEX:00a735</id>
//     <value>HEX:7760894f9926fea017f8f8f0a95e4128feabf95c2dc9bab47434ff21eefaa53c</value>
//     <signature>HEX:8e7db557c15caaf3002461f8a705eced17cabcfc6e784dd49f80a38d978aef601db3c0cf90db3127e984584e5954dc8d401f0926bd13793e3bc5383c8aafef84</signature>
//   </skey>
// </iq>

WhatsApi.prototype.sendKeys = function(fresh, countPreKeys) {
  return new Promise( function(resolve, reject ){
    Promise.all([ (fresh?axolotl.generateIdentityKeyPair():this.keystore.getLocalIdentityKeyPair()),
                (fresh?axolotl.generateRegistrationId():this.keystore.getLocalRegistrationId()),
                axolotl.generatePreKeys(crypto.randomBytes(4).readUInt32LE(0), countPreKeys || WhatsApi._COUNT_PREKEYS)] //4 bytes -> max 4294967295
              )
      .then( function(results){
        var identityKeyPair     = results[0];
        var registrationId      = results[1];
        var preKeys             = results[2];
        axolotl.generateSignedPreKey(identityKeyPair, crypto.randomBytes(2).readUInt16LE(0)) //2 bytes -> max 65535
          .then( function(result){ 
            var signedPreKey = result;
            
            this.sendNode( this.createSendKeysNode(registrationId, identityKeyPair, preKeys, signedPreKey) );
            
            this.persistKeys(registrationId, identityKeyPair, preKeys, signedPreKey, fresh)
              .then( function(result){
                resolve();
              });
            
          }.bind(this))
          .catch( function(error){ console.log('sendKeys error: %s', error);});
      }.bind(this))
      .catch( function(error){ console.log('sendKeys error: %s', error);});
  }.bind(this));
};

WhatsApi.prototype.createSendKeysNode = function(registrationId, identityKeyPair, preKeys, signedPreKey) {
  var messageId = this.nextMessageId('send_keys');
  var tmpBuffer32 = new Buffer(4);
  var tmpBuffer24 = new Buffer(3);
  var tmpBuffer8 = new Buffer(1);
  var keyNodes = preKeys.map(function(preKey) {
    tmpBuffer24.writeUInt24BE(preKey.id,0);
    return new protocol.Node(
      'key',
      null,
      [ new protocol.Node('id',null,null, new Buffer(tmpBuffer24) ), 
        new protocol.Node('value',null,null, common.toBuffer(preKey.keyPair.public.slice(1))) //strip the first byte
      ]
    );
  }, this);
  var listNode = new protocol.Node('list', null, keyNodes);
  
  var identityNode = new protocol.Node('identity', null, null, common.toBuffer(identityKeyPair.public.slice(1)) ); //strip the first byte
  tmpBuffer32.writeUInt32BE(registrationId,0);
  var registrationNode = new protocol.Node('registration', null, null, new Buffer(tmpBuffer32) );
  tmpBuffer8.writeUInt8(5,0);
  var typeNode = new protocol.Node('type', null, null, new Buffer(tmpBuffer8) ); //DJB_TYPE / curve25519 keys
  
  tmpBuffer24.writeUInt24BE(signedPreKey.id,0);
  var sKeyNode = new protocol.Node(
    'skey',
    null,
    [ new protocol.Node('id',null,null, new Buffer(tmpBuffer24) ),
      new protocol.Node('value',null,null, common.toBuffer(signedPreKey.keyPair.public.slice(1))), //strip the first byte
      new protocol.Node('signature',null,null, common.toBuffer(signedPreKey.signature)) //strip the first byte
    ]
  );
  
  var attributes = {
    to   : this.config.server,
    xmlns: 'encrypt',
    type   : 'set',
    id : messageId
  };
  return new protocol.Node('iq', attributes, [listNode, identityNode, registrationNode, typeNode, sKeyNode]);

}

WhatsApi.prototype.persistKeys = function(registrationId, identityKeyPair, preKeys, signedPreKey, fresh) {
  return new Promise( function(resolve, reject ){
  
    this.keystore.storeLocalData(registrationId, identityKeyPair)
      .catch(function(error){console.log("storeLocalData error:", error, error.stack());});
    this.keystore.storeSignedPreKey(signedPreKey.id, signedPreKey)
      .catch(function(error){console.log("storeSignedPreKey error: ", error.stack);});
    
    
    preKeys.forEach( function(preKey){
      this.keystore.storePreKey( preKey.id, preKey )
        .catch(function(error){console.log(error);});
    }.bind(this));
    
    //ToDo: this should be changed to resolve when everything is finished
    resolve();
  }.bind(this));
};

WhatsApi.prototype.getSession = function(jid) {
  
  this.keystore.loadSession(jid, 1)
    .then( function(result){
      if(result){
        this.sessions[jid] = result;
        this.processPendingMessages(jid);
      }else{
        this.getKeys(jid);
      }
    }.bind(this))
    .catch( function(error){
      console.log("getSession error: ", error.stack);
    })
  
};


// <message to="xxxxxxxxxx@s.whatsapp.net" type="text" id="1429301769-1">
// <enc v="1" type="pkmsg" av="Android/2.11.471">
// ?Ĉ!?ܙ??~^l?ð????7?&Q?V7#![?&??M?!?b?D??L???Xs???(??݈k"B3
// !j??Q???ۿ1Ub??맒?EL??AQ??K"ڗ?UڅG4??n!hݬ/??)Y(?(????0??
// HEX:3308bdc4880512210595ef998edc9905e4fb7e5e6cc315c3b0a8bc07bbb937ce261151d208ee5637231a21055bbb2605d2ca4dd321f062f944b5ab4cfb9ad15873b981ec9c28879cdd88046b2242330a21056a96a80e135190f1bbc6dbbf315562e0f0eba792b2454ce0df410251a0a2014b100018002210da97c655da854734eaf0bb6e2168ddac2ff9f92959281ad628bd8c96dd033090fc03
// </enc>
// </message>

WhatsApi.prototype.sendEncryptedMessage = function(jid, message, msgid, callback) {
  
  axolotl.encryptMessage(this.sessions[jid], common.toArrayBuffer(new Buffer(message,'utf8')))
    .then(function(ciphertext) {
      this.sessions[jid] = ciphertext.session; //Mqke sure to use the new session for the next message
      this.keystore.storeSession( jid.split('@')[0], 1, this.sessions[jid]);
      
      console.log('sending: %s',common.toBuffer(ciphertext.body).toString('hex'));
      var type = ciphertext.isPreKeyWhisperMessage? 'pkmsg':'msg';
      var encNode = new protocol.Node( 'enc', {v:1, type: type, av: [this.config.device_type,this.config.app_version].join('/')} , null , common.toBuffer(ciphertext.body) );
      
      this.sendMessageNode(jid, encNode, msgid, callback);
    }.bind(this))
    .catch( function(error){
      console.log('error sending encrypted message: ', error, error.stack);
    });
  
};

// rx <message from="xxxxxxxxx@s.whatsapp.net" id="message-xxxxxxxxx-2" type="text" t="1430771906" notify="Test">
// rx   <enc v="1" type="pkmsg" av="Android/2.12.30">116 data length</enc>
// rx </message>

WhatsApi.prototype.processEncryptedMessage = function(node) {
  var message = common.toArrayBuffer( new Buffer(node.child('enc').data()) );
  var jid = node.attribute('from');
  var recipientId = jid.split('@')[0];
  
  var onMessageDecrypted = function(decrypted){
    this.keystore.storeSession(recipientId, 1, decrypted.session);
    
    var message = {
      body      : common.toBuffer(decrypted.message).toString('utf8'),
      from      : node.attribute('from'),
      author    : node.attribute('participant') || '',
      id        : node.attribute('id'),
      date      : new Date(+node.attribute('t') * 1000),
      notify    : node.attribute('notify'),
      isGroup   : node.attribute('from').indexOf('g.us') != -1 ? true : false,
      encrypted : true
    };
    
    /**
     * 
     * receivedMessage - emitted when a new text message is received
     * 
     * @event receivedMessage
     * @property {Message} message     Message object
     */
    this.emit('receivedMessage', message);
    
  }.bind(this);
  

  
  this.sendNode(this.createReceiptNode(node));
  
  if( node.child('enc').attribute('type') == 'msg' ){
    this.keystore.loadSession(jid, 1).then( function(session){
      axolotl.decryptWhisperMessage(session, message)
        .then( onMessageDecrypted )
        .catch( function(error){
          console.log('error processing encrypted message: ', error, error.stack);
        });
    }.bind(this));
    
  }else if(node.child('enc').attribute('type') == 'pkmsg'){
    axolotl.decryptPreKeyWhisperMessage(null, message)
      .then( onMessageDecrypted )
      .catch( function(error){
        console.log('error processing encrypted message: ', error, error.stack);
      });
  }else{
    //error... unknown encryption...
  }
};

WhatsApi.prototype.processEncryptNotification = function(node) {
    var count = node.child('count').attribute('value');
    console.log('server has %d prekey(s) to hand out', count);
    
    
    this.sendKeys(false, WhatsApi._COUNT_PREKEYS - count);      
}

