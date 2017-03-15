var FastMath = function() {
	
};



var epsilon = 2.220446049250313e-16;

FastMath.prototype.epsilon = epsilon;


FastMath.prototype.equal = function(a, b) {
	return this.abs(a - b) < (epsilon);

};

FastMath.prototype.notEqual = function(a, b) {
	return !this.equal(a, b);
};

FastMath.prototype.leq = function(a, b) {
	return a < b || this.equal(a, b);
};

FastMath.prototype.geq = function(a, b) {
	return a > b || this.equal(a, b);
};

FastMath.prototype.lt = function(a, b) {
	return a < b && !this.equal(a, b);
};

FastMath.prototype.gt = function(a, b) {
	return a > b && !this.equal(a, b);
};

FastMath.prototype.max = function(a, b) {
	if (a > b) {
		return a;
	}

	return b;
};

FastMath.prototype.min = function(a, b) {
	if (a < b) {
		return a;
	}

	return b;
};

FastMath.prototype.abs = function(a) {
	if (a < 0) {
		return -a;
	}

	return a;
};

FastMath.prototype.sign = function(a) {
	if (a < 0) {
		return -1;
	}

	if (a > 0) {
		return 1;
	}

	return 0;
};

FastMath.prototype.sqr = function(x) {
	return x * x;
};

FastMath.prototype.trunc = function(a) {
	var num = parseInt(a, 10);
	if (isNaN(num)) {
		return NaN;
	}

	return parseInt(num.toFixed(0), 10);
};

FastMath.prototype.fix = function(a, p) {
	var num = parseFloat(a);
	if (isNaN(num)) {
		return NaN;
	}

	p = parseInt(p, 10);
	if (isNaN(p)) {
		p = 0;
	}

	return parseFloat(num.toFixed(p));
};
/**
 * Returns true if parameter is numeric
 * @param  {object}  n object to test
 * @return {Boolean}   true if object is numeric
 */
FastMath.prototype.isNumeric = function(n) {
	if (arguments.length != 1)
		throw new Error('isNumeric expects one parameter');
	return !isNaN(parseFloat(n)) && isFinite(n);
};

/**
 * Determines if all members of array are numeric
 * @return {Boolean}      true if all array members are numeric
 */
FastMath.prototype.areNumeric = function() {

	var argLength = arguments.length;
	if (argLength === 0)
		return false;

	for (var i = 0; i < argLength; i++) {
		if (!this.isNumeric(arguments[i]))
			return false;
	}
	return true;
};

/**
 * Helper function to be used when comparing numbers
 * @param  {Number} a first number
 * @param  {Number} b second number
 * @return {Number}   positive if a>b, negative if a<b, zero if a==b
 */
FastMath.prototype.compareNumbers = function(a, b) {

	//not using straight a-b comparison here in order to avoid
	//rounding errors!
	if (this.gt(a, b))
		return 1;
	if (this.lt(a, b))
		return -1;

	return 0;
};

/**
 * Performs a binary search on the host array. This method can either be
 * injected into Array.prototype or called with a specified scope like this:
 * binaryIndexOf.call(someArray, searchElement);
 *
 * Courtesy of http://oli.me.uk/2013/06/08/searching-javascript-arrays-with-a-binary-search/
 *
 * usage: var index = binaryIndexOf.call(models, someModel);
 * 
 * @param {*} searchElement The item to search for within the array.
 * @return {Number} The index of the element which defaults to -1 when not found.
 */
FastMath.prototype.binaryIndexOf = function(searchElement) {

	var minIndex = 0;
	var maxIndex = this.length - 1;
	var currentIndex;
	var currentElement;
	var resultIndex;

	while (minIndex <= maxIndex) {
		resultIndex = currentIndex = (minIndex + maxIndex) / 2 | 0;
		currentElement = this[currentIndex];

		if (currentElement < searchElement) {
			minIndex = currentIndex + 1;
		} else if (currentElement > searchElement) {
			maxIndex = currentIndex - 1;
		} else {
			return currentIndex;
		}
	}

	return ~maxIndex;
};
FastMath.prototype.binaryIndexOfObject = function(searchElement, accessor) {

	var minIndex = 0;
	var maxIndex = this.length - 1;
	var currentIndex;
	var currentElement;
	var resultIndex;

	while (minIndex <= maxIndex) {
		resultIndex = currentIndex = (minIndex + maxIndex) / 2 | 0;
		currentElement = this[currentIndex];

		var current = accessor.call(currentElement);
		var search = searchElement;

		if (current < search) {
			minIndex = currentIndex + 1;
		} else if (current > search) {
			maxIndex = currentIndex - 1;
		} else {
			return currentIndex;
		}
	}

	return ~maxIndex;
};



module.exports = new FastMath();