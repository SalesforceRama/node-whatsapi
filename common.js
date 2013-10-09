function tstamp() {
	return Math.floor(Date.now() / 1000);
}

function objSize(obj) {
	var size = 0;

	for(var key in obj) {
		if(obj.hasOwnProperty(key)) {
			++size;
		}
	}

	return size;
}

function toArray(iterable) {
	var arr = [];

	for(var i = 0, len = iterable.length; i < len; i++) {
		arr.push(iterable[i]);
	}

	return arr;
}

function extend(dest) {
	var args   = toArray(arguments),
		target = args.shift();

	for(var i = 0, len = args.length, source; i < len; i++) {
		source = args[i];

		for(var key in source) {
			if(source.hasOwnProperty(key)) {
				target[key] = source[key];
			}
		}
	}

	return target;
}

exports.tstamp  = tstamp;
exports.objSize = objSize;
exports.extend  = extend;