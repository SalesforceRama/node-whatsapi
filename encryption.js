var crypto = require('crypto');
var rc4 = require('./rc4');

function KeyStream(key, macKey) {
	//this.cipher = crypto.createCipheriv('rc4', key, new Buffer(''));
	//this.key    = key;
	this.seq=0;
	this.macKey = macKey;
	var drop = 0x300; //768
	this.rc4engine = new rc4.Engine();
	this.rc4engine.init(key);
	this.rc4engine.drop(0x300);
}

KeyStream.prototype.computeMac = function(buffer, offset, length){
  // $hmac = hash_init("sha1", HASH_HMAC, $this->macKey);
  // hash_update($hmac, substr($buffer, $offset, $length));
  // $array = chr($this->seq >> 24)
  //     . chr($this->seq >> 16)
  //     . chr($this->seq >> 8)
  //     . chr($this->seq);
  // hash_update($hmac, $array);
  // $this->seq++;
  // return hash_final($hmac, true);
	
  var hmac  = crypto.createHmac('sha1', this.macKey);
	hmac.update(buffer.slice(offset,offset+length));
	
	var updateBuffer = new Buffer([this.seq >> 24, (this.seq >> 16)%256, (this.seq >> 8)%256, (this.seq)%256]);	
	hmac.update(updateBuffer);
	
	this.seq++;	
	return hmac.digest();
};

//WAUTH-2
KeyStream.prototype.encodeMessage = function(buffer, macOffset, offset, length){
    // $data = $this->rc4->cipher($buffer, $offset, $length);
    // $mac  = $this->computeMac($data, $offset, $length);
    // return substr($data, 0, $macOffset) . substr($mac, 0, 4) . substr($data, $macOffset + 4);
		var data = this.rc4engine.cipher(buffer, offset, length);
		var mac = this.computeMac(data, offset, length);
		return Buffer.concat( [data.slice(0, macOffset), mac.slice(0,4), data.slice(macOffset + 4)] );
};

//WAUTH-2
KeyStream.prototype.decodeMessage = function(buffer, macOffset, offset, length){
    // $mac = $this->computeMac($buffer, $offset, $length);
    // //validate mac
    // for ($i = 0; $i < 4; $i++) {
    //     $foo = ord($buffer[$macOffset + $i]);
    //     $bar = ord($mac[$i]);
    //     if ($foo !== $bar) {
    //         throw new Exception("MAC mismatch: $foo != $bar");
    //     }
    // }
    // return $this->rc4->cipher($buffer, $offset, $length);
		var mac = this.computeMac(buffer, offset, length);
		return this.rc4engine.cipher(buffer, offset, length);
};



// KeyStream.prototype.encode = function(data, append) {
// 	if(append !== false) {
// 		append = true;
// 	}
// 
// 	var hash  = this.cipher.update(data),
// 			affix = hmac.slice(0, 4);
// 		// hmac  = crypto.createHmac('sha1', this.key).update(hash).digest(),
// 		// affix = hmac.slice(0, 4);
// 
// 	var buffers = append ? [hash, affix] : [affix, hash];
// 
// 	return Buffer.concat(buffers, affix.length + hash.length);
// };

// KeyStream.prototype.decode = function(data) {
// 	return this.cipher.update(data.slice(4)).slice();
// };

function pbkdf2(password, salt, iterations, length) {
	iterations = iterations || 16;
	length     = length || 20;

	return crypto.pbkdf2Sync(password, salt, iterations, length);
}

exports.KeyStream = KeyStream;
exports.pbkdf2    = pbkdf2;