var camSegment= require('../lib/segments/camSegment');
var BasicSegment=require('../lib/segments/basicSegment');



describe('Cubic spline calculations', function () {



    describe('Should solve points (1,2),(2,4)', function () {

        it('Result with zero initial slopes should be [2,0,6,-4]', function () {
            var result = camSegment.calculateCubic([1, 2], [2, 4], 0, 0);
            // console.log(result);
            expect(result).toEqual([[2, 0, 6, -4]]);

        });

        it('Result with s0=1, sf=2 should be [2,1,2,-1]', function () {
            var result = camSegment.calculateCubic([1, 2], [2, 4], 1, 2);
            // console.log(result);         
            expect(result).toEqual([[2, 1, 2, -1]]);
        });

    });

    describe('should solve points (0,2)(2,4)', function () {
        it('Result with s0=1, sf=2 should be [2,1,2,-1]', function () {
            var result = camSegment.calculateCubic([0, 1], [2, 4], 1, 2);
            // console.log(result);
            expect(result).toEqual([[2, 1, 2, -1]]);

        });

        it('Result with s0=-1, sf=2 should be [2,1,6,-3]', function () {
            var result = camSegment.calculateCubic([0, 1], [2, 4], -1, 2);
            // console.log(result);
            expect(result).toEqual([[2, -1, 6, -3]]);

        });

    });

    describe('should solve points (0,0),(1,0),(3,2),(4,2)', function () {
        it('Result with s0=1 and sf=0 should be [', function () {
            var result = camSegment.calculateCubic([0, 1, 3, 4], [0, 0, 2, 2], 0, 0);
            // console.log(result);         
            expect(result).toEqual(
                [[0, 0, -0.4285714285714286, 0.4285714285714286],
                  [0,
                    0.4285714285714286,
                    0.8571428571428572,
                    -0.28571428571428575],
                  [2, 0.4285714285714286, -0.8571428571428572, 0.4285714285714286]]
                  );
        });
    });

});

describe("Linear interpolation", function () {
    describe('should solve points (0,2)(2,4)', function () {
        it('Result should be [[2,1]]', function () {
            var result = camSegment.calculateLinear([0, 2], [2, 4]);
            // console.log(result);     
            expect(result.length).toBe(1);
            expect(result).toEqual([[2, 1, 0, 0]]);
        });
    });

    describe('should solve points (0,2)(2,4),(4,4)', function () {
        it('Result should be [ [ 2, 1,0,0 ], [ 4, 0,0,0 ]]', function () {
            // console.log(result);     
            var result = camSegment.calculateLinear([0, 2, 4], [2, 4, 4]);
            expect(result).toEqual([[2, 1, 0, 0], [4, 0, 0, 0]]);
        });
    });

    describe('should solve points (0,2)(2,4),(4,5)', function () {
        it('Result should be [ [ 2, 1,0,0 ], [ 4, 0.5,0,0 ]]', function () {
            // console.log(result);     
            var result = camSegment.calculateLinear([0, 2, 4], [2, 4, 5]);
            expect(result).toEqual([[2, 1, 0, 0], [4, 0.5, 0, 0]]);
        });
    });
});



// describe("Full table calculations", function () {
//     it('Should have the validated results', function () {
//         var result = camSegment.calculateCamCoefficients([0, 1, 3, 5, 7], [0, 2, 4, 5, 8], [1, 1, 0, 1], 0, 0);
//         // console.log(result);
//         expect(result).toEqual(
//             [[0,
//                 4.440892098500626e-16,
//                 3.583333333333333,
//                 -1.5833333333333333],
//               [2,
//                 2.4166666666666665,
//                 -1.1666666666666667,
//                 0.22916666666666666],
//               [4, 0.5, 0, 0],
//               [5, 0.5, 1.5, -0.5]]
//               );
//     });
// });



describe('Unit: cam segment (logix element) testing', function() {




    it('should create a valid cam segment using ', function() {

        var basicSegs = camSegment.calculateBasicSegments([0, 1, 3, 5, 7], [0, 2, 4, 5, 8], [1, 1, 0, 1], 0, 0);

        expect(basicSegs.length).toBe(4);
        expect(basicSegs.every(function(seg){
            return seg instanceof BasicSegment.BasicMotionSegment;
        }));

        var seg0=basicSegs[0];
        var seg1=basicSegs[1];
        var seg2=basicSegs[2];
        var seg3=basicSegs[3];


        expect(seg0.evaluatePositionAt(0.5)).toBeCloseTo(0.6979125,5);
        expect(seg0.evaluateVelocityAt(0.5)).toBeCloseTo(2.395825,4);

        expect(seg1.evaluatePositionAt(1.5)).toBeCloseTo(2.94531225,5);

        expect(seg2.evaluatePositionAt(4)).toBeCloseTo(4.5,5);

        expect(seg3.evaluatePositionAt(6)).toBeCloseTo(6.625,5);


    });

});