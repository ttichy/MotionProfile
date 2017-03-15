	/**
	 * Object Extending Functionality
	 * https://gist.github.com/bhavyaw/25b115603630ebf2271d
	 */
	var extend = function(out) {
		  out = out || {};
		  for (var i = 1; i < arguments.length; i++) {
		    if (!arguments[i])
		      continue;

		    for (var key in arguments[i]) {
		      if (arguments[i].hasOwnProperty(key))
		        out[key] = arguments[i][key];
		    }
		  }
		  return out;
	};

	// export CommonJS way
	exports.extend=extend;

	/**
	 * angular isObject shim
	 * @param  {Object}  obj object to check
	 * @return {Boolean}     true if object
	 */
	var isObject = function(obj) {
		return obj !== null && typeof obj ==='object';
	};

	exports.isObject = isObject;


	/**
	 * Mimics angular isUndefined functionality
	 * @param  {Object}  obj object to test
	 * @return {Boolean}     true if unefined
	 */
	var isUndefined = function(obj) {
		return typeof obj === 'undefined';
	}
	exports.isUndefined=isUndefined;