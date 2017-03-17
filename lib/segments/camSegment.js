var MotionSegment = require('./motionSegment');
var BasicSegment = require('./basicSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var numeric = require('numeric');

var factory = {};



/**
 * CamMotionSegment -  handles operations on cam segments
 * @param {numbewr} prevTime previous segment's final time
 * @param {number} prevPosition previous segment's final position
 * @param {number} prevVelocity previous segments' final velocity
 */
var CamMotionSegment = function(prevTime, prevPosition, prevVelocity,loads) {

    var t0 = prevTime || 0;
    var p0 = prevPosition || 0;
    var v0 = prevVelocity || 0;

    var tf = t0 + 1; // default - add 1 second just like MA7

    var pf = p0+1 ; // MA7 like

    MotionSegment.MotionSegment.call(this, t0, tf);


    this.type = 'cam';


    // each segment (regardless of type) has initialTime and finalTime
    this.initialTime = t0;
    this.finalTime = tf;

    if(! loads) {
         //thrust is external force or torque
            this.thrust = 0;

            //friction - either friction coefficient (for linear) or friction (for rotary)
            this.friction = 0;

            //load - either mass or inertia
            this.load = 0;
    }
    else {
        this.thrust = loads.thrust || 0;
        this.friction = loads.friction || 0;
        this.load = loads.load || 0;
    }




};


CamMotionSegment.prototype = Object.create(MotionSegment.MotionSegment.prototype);
CamMotionSegment.prototype.constructor = CamMotionSegment;


/**
 * Calculates linear interpolation for X and Y points
 * @param {array} X array of master positions
 * @param {array} Y array of slave positions
 */
CamMotionSegment.prototype.calculateLinear = function(X, Y) {

    if (!Array.isArray(X) || !Array.isArray(Y))
        throw new Error("X and Y must be arrays");

    if (X.length != Y.length) {
        throw new Error("Matrices must have the same length");
    }

    if (X.length == 1)
        throw new Error("Cannot interpolate a single point");

    var A = [];

    for (var i = 1; i < X.length; i++) {
        var slope = (Y[i] - Y[i - 1]) / (X[i] - X[i - 1]);
        var icpt = Y[i - 1];
        A[i - 1] = [icpt, slope, 0, 0];
    }


    return A;

};


/**
 * Calculates coefficients for an array of X and Y values using cubic splines
 * @param {double Array} X  array of X values
 * @param {double Array} Y  array of Y values
 * @param {double} s0 initial slope
 * @param {double} sf final slope
 */
CamMotionSegment.prototype.calculateCubic = function(X, Y, s0, sf) {

    //-----<INPUTS>---------------------------------------

    // var s0=0;
    // var sf=0;

    // var X = [1,2];   //define X points
    // var Y = [2,4];   //define Y points
    //-----</INPUTS>----------------------------------------


    // data checks
    if (!Array.isArray(X) || !Array.isArray(Y))
        throw new Error("X and Y must be arrays");

    if (X.length != Y.length) {
        throw new Error("Matrices must have the same length");
    }

    if (X.length == 1)
        throw new Error("Cannot interpolate a single point");

    /**
     * [Am populate matrix row]
     * @param {int} m [1, 2 or 3 which row entry (each matrix row has three entries]
     * @param {int} r matrix row
     * @param {array} h array of hs (master position differences)
     */
    var Am = function(m, r, h) {

        var hSize = h.length + 1;
        if (r > hSize)
            throw new Error("passed row number too large.");

        // juggle the h's a bit in order to make handle first and last row
        var prevH = h[r - 1];
        if (!!!prevH)
            prevH = 0;
        var thisH = h[r];
        if (!!!thisH)
            thisH = 0;


        switch (m) {
            case 1:
                return prevH;
            case 2:
                return 2 * (prevH + thisH);
            case 3:
                return thisH;
            default:
                throw new Error("only 1,2 or 3 are valid values for m");

        }
    };

    var Bm = function(r, d) {
        //first row?
        if (r === 0)
            return 6 * (d[0] - s0);

        //last row?
        if (r == d.length)
            return 6 * (sf - d[r - 1]);

        //all other rows
        return 6 * (d[r] - d[r - 1]);
    };

    // define and assign h and slopes d
    var h = [];
    var d = [];

    for (var i = 1; i < X.length; i++) {
        h[i - 1] = X[i] - X[i - 1];
        d[i - 1] = (Y[i] - Y[i - 1]) / h[i - 1];
    }

    // need to have matrices in form AX=B, then can do
    // inv(A)*B=X

    var rows = X.length;
    var cols = rows;

    var A = [];
    var B = [];
    var C = [];


    for (var row = 0; row < rows; row++) {
        //create a new row and fill with zeroes
        A[row] = Array.apply(null, new Array(cols)).map(Number.prototype.valueOf, 0);

        // which column to start in
        var startCol = row - 1;
        var stopCol = startCol + 2;

        //special cases for first and last row
        if (startCol < 0) {
            stopCol = 1;
            startCol = 0;
        }

        if (stopCol > rows - 1)
            stopCol = rows - 1;

        for (var col = startCol; col <= stopCol; col++) {
            A[row][col] = Am(col - row + 2, row, h);
        }

        B[row] = [];
        B[row][0] = Bm(row, d);

    }

    var Ainv = numeric.inv(A);
    C = numeric.dot(Ainv, B);

    //flatten result into one array mk
    var mk = [];
    mk = mk.concat.apply(mk, C);

    //calculate the rest of coefficients
    var aa = [];
    var bb = [];
    var cc = [];
    var dd = [];
    var result = [];

    for (i = 0; i < X.length - 1; i++) {
        aa[i] = Y[i];
        bb[i] = d[i] - (h[i] / 6) * (2 * mk[i] + mk[i + 1]);
        cc[i] = mk[i] / 2;
        dd[i] = (mk[i + 1] - mk[i]) / (6 * h[i]);

        result[i] = [];
        result[i] = [aa[i], bb[i], cc[i], dd[i]];
    }

    return (result);
};


/**
 * Gets pertinenta data to be able to serialize/deserilize segment
 * @return {object} data representation of the segment
 */
CamMotionSegment.prototype.exportData = function() {
    var dataObj = {};

    Util.extend(dataObj, this.segmentData);
    dataObj.constructor = this.constructor.name;
    dataObj.type = 'CamMotionSegment';

    return dataObj;

};


/**
 * Deserialize(create) CamMotionSegment from a json string
 * @param  {Object} data data representation of the segment (see exportData())
 * @return {CamMotionSegment}      [description]
 */
CamMotionSegment.prototype.importFromData = function(data) {

    throw new Error("not implemented yet");

};


/**
 * Calculates basic segments from user entered cam table
 * @param  {Array} master        array of master values
 * @param  {Array} slave         array of slave values
 * @param  {Array} interpolation array of interpolation types
 * @param  {number} initialSlope  initial slop
 * @param  {number} finalSlope    final slope
 * @return {Array}               array of newly created basic segments
 */
CamMotionSegment.prototype.calculateCamCoefficients = function(master, slave, interpolation, initialSlope, finalSlope) {

    if (master.constructor != Array || slave.constructor != Array || interpolation.constructor != Array)
        throw new Error("X and slave must be arrays");

    if (master.length !== slave.length) {
        throw new Error("Matrices must have the same length");
    }

    if (master.length === 1)
        throw new Error("Cannot interpolate a single point");

    if (master.length - 1 !== interpolation.length)
        throw new Error("invalid length of types array T");

    if (!interpolation.every(function(el, idx, array) {

            return el === 1 || el === 0;
        }))
        throw new Error("only 1 or 0 is a valid interploation type");


    var result = [];

    var currentRow = 1;
    var cubicStart = 0;
    var initSlope = initialSlope;
    var cubicSegs;
    var coeffs3;

    while (currentRow <= master.length - 1) {
        if (interpolation[currentRow - 1] === 0) {

            //calculate the linear segment first, cuz need final slope
            var linRes = this.calculateLinear(master.slice(currentRow - 1, currentRow + 1), slave.slice(currentRow - 1, currentRow + 1));

            finalSlope = linRes[0][1];

            //need to calculate all previous cubic rows
            cubicSegs = currentRow - cubicStart;
            if (cubicSegs > 1) {
                coeffs3 = this.calculateCubic(master.slice(cubicStart, cubicStart + cubicSegs),
                    slave.slice(cubicStart, cubicStart + cubicSegs),
                    initSlope,
                    finalSlope);

                result = result.concat(coeffs3);
            }


            initSlope = linRes[0][1];

            result = result.concat(linRes);
            cubicStart = currentRow;
        }

        currentRow++;
    }


    // there may be 'leftover' cubic segments
    //current row is passed the last row now, so need to subtract one to get to actual number of segments
    cubicSegs = currentRow - 1 - cubicStart;

    // use final slope that user specified
    finalSlope = finalSlope;

    if (cubicSegs > 0) {
        coeffs3 = this.calculateCubic(master.slice(cubicStart, cubicStart + cubicSegs + 1),
            slave.slice(cubicStart, cubicStart + cubicSegs + 1),
            initSlope,
            finalSlope);
        result = result.concat(coeffs3);
    }

    return result;

};

factory.calculateCubic = CamMotionSegment.prototype.calculateCubic;
factory.calculateLinear = CamMotionSegment.prototype.calculateLinear;
factory.calculateCamCoefficients = CamMotionSegment.prototype.calculateCamCoefficients;

module.exports=factory;
