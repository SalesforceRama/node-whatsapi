var common = require('./common');
var sqlite3 = require('sqlite3').verbose();
var traverse = require('traverse');
var ProtoBuf = require('protobufjs');
var SessionProtos = require('./protobuf/SessionProtos');

function KeyStore( filePath ) {
  var _db = null;
  this.filePath = filePath;
}

KeyStore.prototype.openDatabase = function(){

  return new Promise( function(resolve, reject ){
    //initialize DB connection
    _db = new sqlite3.Database(this.filePath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      function(err){
          if(err === null) resolve('DB: opened succesfuly');
            else reject(Error('DB: opening error: ', err));
      });
    
  }.bind(this));

};


KeyStore.prototype.init = function(){

  return new Promise( function(resolve, reject ){
    this.openDatabase().then(
      function (response){
        Promise.all([this.initIdentityKeyStore(),
                     this.initPreKeyStore(), 
                    this.initSignedPreKeyStore(), 
                    this.initSessionStore()]
                   ).then( function(results){
                      results.forEach( function(result) { console.log(result); });
                      resolve('KeyStore: inited');
                     }
                   ).catch( function(error){console.log(error);});
        console.log(response);
        
      }.bind(this)
    ).catch(
      function (error){
        console.log(error);
        reject(Error('KeyStore: Not inited: %s', error));
      }
    );
  }.bind(this));
};


KeyStore.prototype.initIdentityKeyStore = function(){
   return new Promise( function(resolve, reject) {
    //SQL statement copied from Yowsup
    _db.exec( "CREATE TABLE IF NOT EXISTS identities (_id INTEGER PRIMARY KEY AUTOINCREMENT, \
                         recipient_id INTEGER UNIQUE, \
                         registration_id INTEGER, public_key BLOB, private_key BLOB \
                         next_prekey_id INTEGER, timestamp INTEGER);", 
                  function(err){
                           if(err===null) resolve('DB: identities table inited');
                             else reject( Error('DB: identities table error: %s', err));
                          
                  } );
  }.bind(this));
};

KeyStore.prototype.initPreKeyStore = function(){
    return new Promise( function(resolve, reject) {
    //SQL statement copied from Yowsup
    _db.exec( "CREATE TABLE IF NOT EXISTS prekeys (_id INTEGER PRIMARY KEY AUTOINCREMENT, \
                         prekey_id INTEGER UNIQUE, sent_to_server BOOLEAN, record BLOB);",
                  function(err){
                           if(err===null) resolve('DB: prekeys table inited');
                             else reject(Error('DB: prekeys table error: %s', err));
                          
                        } );
  }.bind(this));
};

KeyStore.prototype.initSignedPreKeyStore = function(){
   return new Promise( function(resolve, reject) {
    //SQL statement copied from Yowsup
    _db.exec( "CREATE TABLE IF NOT EXISTS signed_prekeys (_id INTEGER PRIMARY KEY AUTOINCREMENT, \
                         prekey_id INTEGER UNIQUE, timestamp INTEGER, record BLOB);",
                  function(err){
                           if(err===null) resolve('DB: signed_prekeys table inited');
                             else reject(Error('DB: signed_prekeys table error: %s', err));
                          
                        } );  
  }.bind(this));
};

KeyStore.prototype.initSessionStore = function(){
   return new Promise( function(resolve, reject) {
    //SQL statement copied from Yowsup
    _db.exec( "CREATE TABLE IF NOT EXISTS sessions (_id INTEGER PRIMARY KEY AUTOINCREMENT, \
                         recipient_id INTEGER UNIQUE, device_id INTEGER, record BLOB, timestamp INTEGER);",
                  function(err){
                           if(err===null) resolve('DB: sessions table inited');
                             else reject(Error('DB: sessions table error: %s', err));
                          
                        });  
  }.bind(this));
};

KeyStore.prototype.storeLocalData = function(registrationId, identityKeyPair){
  return new Promise( function(resolve, reject) {
    console.log('registrationId: %o', registrationId);
    _db.run( "INSERT OR REPLACE INTO identities(recipient_id, registration_id, public_key, private_key) VALUES(-1,?,?,?)",
                  [registrationId, common.toBuffer(identityKeyPair.public), common.toBuffer(identityKeyPair.private)],
                  function(err){
                    if(err===null){
                      console.log('DB: storeLocalData done');
                      resolve();
                    }  else {
                      console.log('DB: error storeLocalData: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.storeSignedPreKey = function(signedPreKeyId, signedPreKeyRecord){
  return new Promise( function(resolve, reject) {
    _db.run( "INSERT INTO signed_prekeys (prekey_id, record) VALUES(?,?)",
                  [ signedPreKeyId, 
                    Buffer.concat([common.toBuffer(signedPreKeyRecord.keyPair.public),
                      common.toBuffer(signedPreKeyRecord.keyPair.private),
                      common.toBuffer(signedPreKeyRecord.signature)])
                  ],
                  function(err){
                    if(err===null){
                      console.log('DB: storeSignedPreKey done');
                      resolve();
                    }  else {
                      console.log('DB: error storeSignedPreKey: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.storePreKey = function(preKeyId, preKeyRecord){
  console.log('storePreKey id: %d', preKeyId);
  return new Promise( function(resolve, reject) {
    _db.run( "INSERT INTO prekeys (prekey_id, record) VALUES(?,?)",
                  [ preKeyId, 
                    Buffer.concat([common.toBuffer(preKeyRecord.keyPair.public),
                      common.toBuffer(preKeyRecord.keyPair.private)])
                  ],
                  function(err){
                    if(err===null){
                      console.log('DB: storePreKey done');
                      resolve();
                    }  else {
                      console.log('DB: error storePreKey: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.storeSession = function(recipientId, deviceId, sessionRecord){
  console.log('storeSession for recipientId: %d', recipientId);
  
  var serializedSession = new SessionProtos.Session(sessionRecord).encode();
    

  
  return new Promise( function(resolve, reject) {
    _db.run( "INSERT OR REPLACE INTO sessions (recipient_id, device_id, record) VALUES(?,?,?)",
                  [ recipientId,
                    deviceId,
                    serializedSession.buffer
                  ],
                  function(err){
                    if(err===null){
                      console.log('DB: storeSession done');
                      resolve();
                    }  else {
                      console.log('DB: error storeSession: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.getLocalIdentityKeyPair = function(){
  return new Promise( function(resolve, reject) {
    _db.get( "SELECT public_key, private_key FROM identities WHERE recipient_id = ?",
                  [-1],
                  function(err, row){
                    if(err===null){
                      if (!row){
                        reject( Error('DB: local identity not found') );
                      }else{
                        result = {public: common.toArrayBuffer(row.public_key), private: common.toArrayBuffer(row.private_key)};
                        resolve( result );
                      }
                    }  else {
                      console.log('DB: error fetching local identity keypair: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.getLocalSignedPreKeyPair = function(prekey_id){
  return new Promise( function(resolve, reject) {
    _db.get( "SELECT record FROM signed_prekeys WHERE prekey_id = ?",
                  [prekey_id],
                  function(err, row){
                    if(err===null){
                      if (!row){
                        reject( Error('DB: local signed prekey for id '+prekey_id+' not found') );
                      }else{
                        var record = common.toArrayBuffer(row.record);
                        var keyPair = { public: record.slice(0,33),
                                        private: record.slice(33, 65)};
                        var signature = record.slice(65);
                        console.log('DB: local signed prekey record: %s', record);
                        resolve( {id: prekey_id, keyPair: keyPair, signature: signature} );
                      }
                    }  else {
                      console.log('DB: error fetching local signed prekey: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.getLocalPreKeyPair = function(prekey_id){
  return new Promise( function(resolve, reject) {
    _db.get( "SELECT record FROM prekeys WHERE prekey_id = ?",
                  [prekey_id],
                  function(err, row){
                    if(err===null){
                      if (!row){
                        reject( Error('DB: local prekey not found') );
                      }else{
                        var record = common.toArrayBuffer(row.record);
                        var keyPair = { public: record.slice(0,33),
                                        private: record.slice(33) };
                        console.log('DB: local prekey record: %s', record);
                        resolve( { id: prekey_id, keyPair: keyPair } );
                      }
                    }  else {
                      console.log('DB: error fetching local prekey: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this)); 
};

KeyStore.prototype.getLocalRegistrationId = function(){
  return new Promise( function(resolve, reject) {
    _db.get( "SELECT registration_id FROM identities WHERE recipient_id = ?",
                  [-1],
                  function(err, row){
                    if(err===null){
                      if (!row){
                        reject( Error('DB: local registration_id not found') );
                      }else{
                        resolve( row.registration_id );
                      }
                    }  else {
                      console.log('DB: error fetching local registration_id keypair: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

KeyStore.prototype.loadSession = function(jid, deviceId){
  var registraiondId = jid.split('@')[0];
  return new Promise( function(resolve, reject) {
    _db.get( "SELECT record FROM sessions WHERE recipient_id = ? AND device_id = ?",
                  [registraiondId, deviceId],
                  function(err, row){
                    if(err===null){
                      if (!row){
                        resolve( null );
                      }else{
                        var session = SessionProtos.Session.decode(common.toArrayBuffer(row.record));
                        //Fixup bytes -> ArrayBuffer
                        traverse(session).forEach( function(element){
                          if (element && typeof element === 'object' && element.buffer ){
                            return this.update(common.toArrayBuffer(element.buffer.slice(element.offset, element.limit)));
                          }
                        });
                        resolve( session );
                      }
                    }  else {
                      console.log('DB: error fetching session: %s', err);
                      reject( Error(err) );
                    }
                  });
  }.bind(this));
};

exports.KeyStore = KeyStore;