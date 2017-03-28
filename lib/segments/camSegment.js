var MotionSegment = require('./motionSegment');
var BasicSegment = require('./basicSegment');
var fastMath = require('../util/fastMath');
var Util = require('../util/util');

var numeric = require('numeric');

var factory = {};

var InterpolationEnum = Object.freeze({
    "LINEAR": 0,
    "CUBIC":1
});


/** Describes cam data table
The expectation is that the first item in master and slave array is the initial time and initial position resp.
 */
var CamTable = function() {
    this.master=[];
    this.slave=[];
    this.interpolation=[];
    this.finalSlope=0;
    this.initialSlope=0;
};


/**
 * Validates data in the cam table
 * @return {[type]} [description]
 */
CamTable.prototype.validate = function() {
    
    if (!Array.isArray(this.master))
        throw new Error("expecting `master` data to be array");

    if (!Array.isArray(this.master))
        throw new Error("Expecting `slave` data to be array");

    if (this.master.length != this.slave.length)
        throw new Error("Expecting `master` and `slave` to have the same length");


    if (!Array.isArray(this.interpolation))
        throw new Error("Expecting `interpolation` to be an array");

    if (this.interpolation.length != this.master.length - 1)
        throw new Error("Expecting `interpolation` length to be one less than `master` length");


    if (!this.interpolation.every(function(el, idx, array) {

            return el === InterpolationEnum.CUBIC || el === InterpolationEnum.LINEAR;
        }))
        throw new Error("only 1 or 0 is a valid interploation type");


    for (var i = 1; i < this.master.length; i++) {
        if(!Number.isFinite(this.master[i]))
            throw new Error("Expecting master value at row "+i+" to be finite");
        if(!Number.isFinite(this.master[i-1]))
            throw new Error("Expecting master value at row "+i+" to be finite");
        if(fastMath.leq(this.master[i],this.master[i-1]))
            throw new Error("Expecting master values to be sorted ascending");
    }

    return true;

};



/**
 * CamMotionSegment -  handles operations on cam segments
 * @param {number} prevTime previous segment's final time
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

    this.segmentData=new CamTable();

    
    this.segmentData.master= [t0,tf];
    this.segmentData.slave=[p0,pf];
    this.segmentData.interpolation= [InterpolationEnum.CUBIC];
    this.segmentData.initialSlope= prevVelocity;
    this.segmentData.finalSlope = 0;


    this.type = 'cam';

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

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.segments.initializeWithSegments(basicSegments);

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
 * Modifies segment initial values. Used when a segment in a profile is changed.
 * @param {number} initialTime new initial time
 * @param {number} initialPosition new initial position
 * @param {number} initialVelocity new initial velocity (initial slope);
 */
CamMotionSegment.prototype.modifyInitialValues = function(initialTime, initialAcceleration, initialVelocity,initialPosition) {
    if(initialTime < 0)
        throw new Error("initialTime < zero. Cam table master values can't be negative");

    var timeDelta = initialTime-this.segmentData.master[0];
    var posDelta =initialPosition-this.segmentData.slave[0];

    for (var i = 0; i < this.segmentData.master.length; i++) {
        this.segmentData.master[i]+=timeDelta;
        this.segmentData.slave[i] +=posDelta;
    }

    this.segmentData.initialSlope=initialVelocity;

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.initialTime=this.segmentData.master[0];
    this.finalTime=this.segmentData.master[this.segmentData.master.length-1];

    this.segments.initializeWithSegments(basicSegments);

};

/**
 * Modifies cam valus with new camtable.
 * Expects cam table has been offset by initial values in UI
 * @param  {Object} camData new cam data
 */
CamMotionSegment.prototype.modifySegmentValues = function(newSegmentData) {
    
    var loads=newSegmentData.loads;
    var camTable = newSegmentData.camTable;

    var finSlope = camTable.finalSlope || 0;
    if(loads)
    {
        this.segmentData.thrust=loads.thrust;
        this.segmentData.load=loads.load;
        this.segmentData.friction=loads.friction;
    }

    this.segmentData.master=camTable.master;
    this.segmentData.slave=camTable.slave;
    this.segmentData.interpolation=camTable.interpolation;
    this.segmentData.finalSlope=finSlope;

    var basicSegments = this.calculateBasicSegments(this.segmentData);

    this.segments.initializeWithSegments(basicSegments);
};

/**
 * Calculates basic segments from a CamTable
 * @param  {CamTable} camTable cam table entered by the user
 * @return {Array}          array of new basic segments
 */
CamMotionSegment.prototype.calculateBasicSegments = function(camTable) {

    if(!(camTable instanceof CamTable))
        throw new Error("Expecting a valid CamTable object in CamMotionSegment.calculateBasicSegments");

    var master=camTable.master;
    var slave = camTable.slave;
    var interpolation =camTable.interpolation;
    var initialSlope=camTable.initialSlope;
    var finalSlope = camTable.finalSlope;


    var result = [];    //used to return coefficients

    var currentRow = 1;
    var cubicStart = 0;
    var initSlope = initialSlope;
    var finSlope;
    var cubicSegs,cubicMasters;
    var coeffs3;
    var seg,i;
    var basicSegments=[];

    while (currentRow <= master.length - 1) {

        //skip cubic segments until there is a linear one
        if (interpolation[currentRow - 1] === 0) {

            //calculate the linear segment first, cuz need final slope
            var linRes = this.calculateLinear(master.slice(currentRow - 1, currentRow + 1), slave.slice(currentRow - 1, currentRow + 1));

            finSlope = linRes[0][1];

            //need to calculate all previous cubic rows
            cubicSegs = currentRow - cubicStart;

            cubicMasters=master.slice(cubicStart, cubicStart + cubicSegs);
            
            if (cubicSegs > 1) {
                coeffs3 = this.calculateCubic(cubicMasters,
                    slave.slice(cubicStart, cubicStart + cubicSegs),
                    initSlope,
                    finSlope);


                //result = result.concat(coeffs3);

                //coeffs3 is an array of arryays
                for (i = 0; i < coeffs3.length; i++) {
                    seg = BasicSegment.CreateBasicSegment(cubicMasters[i],cubicMasters[i+1],coeffs3[i].reverse(),
                        {thrust:this.thrust, load: this.load, friction:this.friction});
                    basicSegments.push(seg);
                }


            }


            initSlope = linRes[0][1];

            seg = BasicSegment.CreateBasicSegment(master[currentRow-1],master[currentRow],linRes[0].reverse(),
                        {thrust:this.thrust, load: this.load, friction:this.friction});
            
            basicSegments.push(seg);
            //result = result.concat(linRes);
            cubicStart = currentRow;
        }

        currentRow++;
    }


    // there may be 'leftover' cubic segments
    //current row is passed the last row now, so need to subtract one to get to actual number of segments
    cubicSegs = currentRow - 1 - cubicStart;


    cubicMasters=master.slice(cubicStart, cubicStart + cubicSegs + 1);
    if (cubicSegs > 0) {
        coeffs3 = this.calculateCubic(cubicMasters,
            slave.slice(cubicStart, cubicStart + cubicSegs + 1),
            initSlope,
            finalSlope);

        //result = result.concat(coeffs3);

        for (i = 0; i < coeffs3.length; i++) {
            seg = BasicSegment.CreateBasicSegment(cubicMasters[i],cubicMasters[i+1],coeffs3[i].reverse(),
                {thrust:this.thrust, load: this.load, friction:this.friction});
            basicSegments.push(seg);
        }

    }

    //return result;

    return basicSegments;    

};



CamMotionSegment.prototype.exportData = function() {

    var dataObj=MotionSegment.MotionSegment.prototype.exportData.call(this);
    dataObj.type="CamMotionSegment";

    return dataObj;
};


CamMotionSegment.prototype.importFromData = function(data) {
    if(data.constructor=="CamMotionSegment") {
        var prevTime=data.master[0];
        var prevPosition=data.slave[0];
        var prevVelocity = data.initialSlope;
        var camSeg = new CamMotionSegment(prevTime,prevPosition,prevVelocity);

        return camSeg;
    }

    throw new Error("CamMotionSegment is expecting to have eponymously named constructor");
};



factory.calculateCubic = CamMotionSegment.prototype.calculateCubic;
factory.calculateLinear = CamMotionSegment.prototype.calculateLinear;
factory.calculateBasicSegments = CamMotionSegment.prototype.calculateBasicSegments;
factory.InterpolationEnum = InterpolationEnum;
factory.CamMotionSegment = CamMotionSegment;
factory.CamTable=CamTable;

/**
 * creates new  cam segment using default values ala MA7
 * @param {numbewr} prevTime previous segment's final time
 * @param {number} prevPosition previous segment's final position
 * @param {number} prevVelocity previous segments' final velocity
 */
factory.createCamSegment=function(prevTime, prevPosition, prevVelocity,loads){
    return new CamMotionSegment(prevTime,prevPosition,prevVelocity,loads);
};

module.exports=factory;
