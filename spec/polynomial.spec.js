describe('Polynomial unit test', function() {
  var fm = require('../lib/util/fastMath');

  var polynomialFactory = require('../../lib/util/polynomial');


  beforeEach(function() {
    module('myApp');


    inject(function(_Polynomial_) {
      polynomialFactory = _Polynomial_;
    });

    inject(function(_FastMath_) {
      fm = _FastMath_;
    });

  });


  it('should create polynomial starting at 0 and evaluate it correctly', function() {
    var poly = polynomialFactory.createPolyAbCd([1, 2, 3, 4], 0, 20);

    var result0 = poly.evaluateAt(0);
    var result1 = poly.evaluateAt(1);
    var result2 = poly.evaluateAt(2);

    expect(result0).toBe(4);
    expect(result1).toBe(10);
    expect(result2).toBe(26);

  });

  it('should create polynomial starting at 1 and evaluate it correctly', function() {
    var poly = polynomialFactory.createPolyAbCd([1, 2, 3, 4], 1, 20);

    var result0 = poly.evaluateAt(1);
    var result1 = poly.evaluateAt(2);
    var result2 = poly.evaluateAt(3);

    expect(result0).toBe(4);
    expect(result1).toBe(10);
    expect(result2).toBe(26);

  });

  it('should create polynomial starting at 1 and throw error when evaluating at 0', function() {
    var poly = polynomialFactory.createPolyAbCd([1, 2, 3, 4], 1, 20);

    expect(function() {
      poly.evaluateAt(0);
    }).toThrow(new Error('Trying to evalute polynomial with x value less than the start point'));

  });

  it('should create polynomial starting at 1 and calculate its derivate', function() {
    var poly = polynomialFactory.createPolyAbCd([1, 2, 3, 4], 1, 20);

    var der = poly.derivative();

    var derAt1 = der.evaluateAt(1);
    var derAt2 = der.evaluateAt(2);

    expect(derAt1).toBe(3);
    expect(derAt2).toBe(10);

    var der2 = der.derivative();

    var der2At1 = der2.evaluateAt(1);
    var der2At3 = der2.evaluateAt(3);

    expect(der2At1).toBe(4);
    expect(der2At3).toBe(16);


  });

  it('should calculate roots of quadratic polynomial [1,-3,-144,432] and its derivative', function() {

    var poly = polynomialFactory.createPolyAbCd([1, -3, -144, 432], 0, 20);

    var roots = poly.roots();

    expect(Array.isArray(roots));
    expect(roots.length).toBe(2);

    //expect(fm.equal(roots[0],-12)); //-12 is not within start/end time
    expect(fm.equal(roots[0], 3));
    expect(fm.equal(roots[0], 12));

    var derivative = poly.derivative();

    roots = derivative.roots();
    expect(roots.length).toBe(1);

    //expect(fm.equal(roots[0],-6)); //-6 is not within start/end time
    expect(fm.equal(roots[0], 8));


  });

  it('should calculate roots of cubic polynomial [1,6,12,8]', function() {

    var poly = polynomialFactory.createPolyAbCd([1, 6, 12, 8], 0, 20);

    var roots = poly.roots();

    expect(Array.isArray(roots));

    //this does have a root at -2, but since -2 is not greater than the startPoint (0), then ..
    expect(roots.length).toBe(0);


  });

  it('should calculate roots of quadratic polynomial [0,1,0,-1]', function() {

    var poly = polynomialFactory.createPolyAbCd([0, 1, 0, -1], 0, 20);

    var roots = poly.roots();

    expect(Array.isArray(roots));
    expect(fm.equal(roots[0], 1)).toBe(true);


  });


  it('should calculate roots of quadratic polynomial [0,1,0,1]', function() {

    var poly = polynomialFactory.createPolyAbCd([0, 1, 0, 1], 0, 20);

    var roots = poly.roots();

    expect(Array.isArray(roots));
    expect(roots.length).toBe(0);


  });


  it('should calculate roots of quadratic polynomial [1,-3,-144,432] and its derivative', function() {

    var poly = polynomialFactory.createPolyAbCd([1, -3, -144, 432], 0, 20);

    var roots = poly.roots();

    expect(Array.isArray(roots));
    expect(roots.length).toBe(2);

    //expect(fm.equal(roots[0],-12)); //-12 is not within start/end time
    expect(fm.equal(roots[0], 3));
    expect(fm.equal(roots[0], 12));

    var derivative = poly.derivative();

    roots = derivative.roots();
    expect(roots.length).toBe(1);

    //expect(fm.equal(roots[0],-6)); //-6 is not within start/end time
    expect(fm.equal(roots[0], 8));


  });



});