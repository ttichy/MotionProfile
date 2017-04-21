var FastMath = require('./fastMath');
var factory = {};
var _ = require('underscore');


/**
 * Polynomial of max 3rd degree
 * @param {Array} coeffArray [description]
 * @param {double} startPoint Point on the X-axis where to start evaluating
 * @param {double} endPoint where on x-axis does the evaluation stop
 */
var Polynomial = function(coeffArray, startPoint, endPoint) {

    this.A = coeffArray[3];
    this.B = coeffArray[2];
    this.C = coeffArray[1];
    this.D = coeffArray[0];
    this.startPoint = startPoint;
    this.endPoint = endPoint;

};


Polynomial.prototype.evaluateAt = function(x) {
    if (FastMath.lt(x, this.startPoint))
        throw new Error('Trying to evalute polynomial with x value less than the start point');
    if (FastMath.gt(x, this.endPoint))
        throw new Error('Trying to evaluate polynomial with x value greater than the end point');
    return this.A * Math.pow(x - this.startPoint, 3) + this.B * Math.pow(x - this.startPoint, 2) + this.C * (x - this.startPoint) + this.D;
};


/**
 * Takes derivative of this polynomial and returns a new polynomial
 * @returns {Polynomial} a new polynomial
 */
Polynomial.prototype.derivative = function() {
    var b = 3 * this.A;
    var c = 2 * this.B;
    var d = this.C;

    return new Polynomial([d, c, b, 0], this.startPoint, this.endPoint);
};


/**
 * Calculate cubic roots - props to http://stackoverflow.com/a/27176424/1579778
 */
Polynomial.prototype.roots = function() {

    var that = this;
    var roots = calculateCubicRoots(this.A, this.B, this.C, this.D);
    return roots.filter(function(value) {
        if (FastMath.geq(value, that.startPoint) && FastMath.leq(value, that.endPoint))
            return true;
    });
};

/**
 * gets all of the extreme values
 * @return {Array} an array of MotionPoints corresponding to the extremum
 */
Polynomial.prototype.getExtremeValues = function () {
    var that = this;
    var firstD = this.derivative();
    var x = calculateCubicRoots(firstD.A, firstD.B, firstD.C, firstD.D);
    x = x.map(function (xxx) {
        return xxx + that.startPoint;
    });
    x = x.filter(function (r) {
        return typeof r == 'number' && !isNaN(r) && isFinite(r) && FastMath.gt(r, that.startPoint) && FastMath.lt(r, that.endPoint);
    });

    // x = [].concat(y, this.startPoint, this.endPoint);
    x = _.uniq([].concat(x, this.startPoint, this.endPoint)).sort(function (curr, next) {
        return curr-next;
    });


    var y = x.map(function (r) {
        return that.evaluateAt(r);
    });

    var minY = _.min(y);
    var maxY = _.max(y);

    var indexes = [];

    // var indexes = y.reduce(function (acc, curr, i, arr) {
    //     return curr == minY || cur == maxY;
    // });

    for (i = 0; i < y.length; i++) {
        if (FastMath.equal(y[i], minY) || FastMath.equal(y[i], maxY)) {
            indexes.push(i);
        }
    }

    var xx = [];
    var yy = [];

    indexes.forEach(function (ind) {
        xx.push(x[ind]);
        yy.push(y[ind]);
    });

    return {x: xx, y: yy};
};


Polynomial.prototype.toPrettyString = function() {
    return this.this.A + '(x-' + this.startPoint + ')^3 + ' + this.B + '(x-' + this.startPoint + ')^2 + ' + this.C + '(x-' + this.startPoint + ')' + this.D;
};


var cuberoot = function cuberoot(x) {
    var y = Math.pow(Math.abs(x), 1 / 3);
    return x < 0 ? -y : y;
};


var calculateCubicRoots = function(a, b, c, d) {
    var D;
    var u;

    if (Math.abs(a) < 1e-8) { // Quadratic case, ax^2+bx+c=0
        a = b;
        b = c;
        c = d;
        if (Math.abs(a) < 1e-8) { // Linear case, ax+b=0
            a = b;
            b = c;
            if (Math.abs(a) < 1e-8) // Degenerate case
                return [];
            return [-b / a];
        }

        D = b * b - 4 * a * c;
        if (Math.abs(D) < 1e-8)
            return [-b / (2 * a)];
        else if (D > 0)
            return [(-b + Math.sqrt(D)) / (2 * a), (-b - Math.sqrt(D)) / (2 * a)];
        return [];
    }

    // Convert to depressed cubic t^3+pt+q = 0 (subst x = t - b/3a)
    var p = (3 * a * c - b * b) / (3 * a * a);
    var q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a);
    var roots;

    if (Math.abs(p) < 1e-8) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cuberoot(-q)];
    } else if (Math.abs(q) < 1e-8) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        roots = [0].concat(p < 0 ? [Math.sqrt(-p), -Math.sqrt(-p)] : []);
    } else {
        D = q * q / 4 + p * p * p / 27;
        if (Math.abs(D) < 1e-8) { // D = 0 -> two roots
            roots = [-1.5 * q / p, 3 * q / p];
        } else if (D > 0) { // Only one real root
            u = cuberoot(-q / 2 - Math.sqrt(D));
            roots = [u - p / (3 * u)];
        } else { // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            u = 2 * Math.sqrt(-p / 3);
            var t = Math.acos(3 * q / p / u) / 3; // D < 0 implies p < 0 and acos argument in [-1..1]
            var k = 2 * Math.PI / 3;
            roots = [u * Math.cos(t), u * Math.cos(t - k), u * Math.cos(t - 2 * k)];
        }
    }

    // Convert back from depressed cubic
    for (var i = 0; i < roots.length; i++)
        roots[i] -= b / (3 * a);



    return roots;
};


/**
 * Creates a new  polynomial with coefficients A,B,C,D
 * Ax^3 + Bx^2 + Cx +D
 * @param {Array} coeffs [array of coefficients]
 * @param {double} startPoint where on x-axis does this poly start
 * @param {double} endPoint where on a x-axis does this poly end
 */
factory.createPolyAbCd = function(coeffs, startPoint, endPoint) {
    if (!Array.isArray(coeffs) || coeffs.length != 4)
        throw new Error('expecting parameter of type array and length 4');

    if (!FastMath.isNumeric(startPoint) || startPoint < 0)
        throw new Error('expecting a valid startpoint');

    if (!FastMath.isNumeric(endPoint) || endPoint <= startPoint)
        throw new Error('expecting valid endpoint');



    var poly = new Polynomial(coeffs.reverse(), startPoint, endPoint);

    return poly;
};

module.exports = factory;