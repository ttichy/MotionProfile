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


/**
 * Solves tridiagonal matrix
 *
 * from https://github.com/feklee/tridiagonal-solve/blob/master/node_main.js
 * 
 * @param  {array} a the lower diagonal
 * @param  {array} b the diagonal
 * @param  {array} c the upper diagonal
 * @param  {array} d right side of the matrix
 * @return {array}   solved unknowns
 */
FastMath.prototype.solveTridiagonalMatrix = function (a, b, c, d) {
	var createCp, createDp, solve, solve1;

	// cp: c'
	createCp = function (a, b, c, n) {
	    var i, cp = [];

	    cp[0] = c[0] / b[0];
	    if (!isFinite(cp[0])) {
	        return null;
	    }

	    for (i = 1; i < n - 1; i += 1) {
	        cp[i] = c[i] / (b[i] - a[i - 1] * cp[i - 1]);
	        if (!isFinite(cp[i])) {
	            return null;
	        }
	    }

	    return cp;
	};

	// dp: d'
	createDp = function (a, b, d, cp, n) {
	    var i, dp = [];

	    dp[0] = d[0] / b[0];
	    if (!isFinite(dp[0])) {
	        return null;
	    }

	    for (i = 1; i < n; i += 1) {
	        dp[i] = (d[i] - a[i - 1] * dp[i - 1]) / (b[i] - a[i - 1] * cp[i - 1]);
	        if (!isFinite(dp[i])) {
	            return null;
	        }
	    }

	    return dp;
	};

	solve = function (a, b, c, d, n) {
	    var i, x = [], cp, dp;

	    cp = createCp(a, b, c, n);
	    if (cp === null) {
	        return null;
	    }
	    dp = createDp(a, b, d, cp, n);
	    if (dp === null) {
	        return null;
	    }

	    x[n - 1] = dp[n - 1];
	    for (i = n - 2; i >= 0; i -= 1) {
	        x[i] = dp[i] - cp[i] * x[i + 1];
	    }

	    return x;
	};

	solve1 = function (b, d) {
	    var x = [d[0] / b[0]];

	    return isFinite(x[0]) ? x : null;
	};


    var n = d.length;

    if (n === 0) {
        return [];
    }

    if (n === 1) {
        return solve1(b, d);
    }

    return solve(a, b, c, d, n);

};

module.exports = new FastMath();