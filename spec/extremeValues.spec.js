var fastMath = require('../lib/util/fastMath');

var customMatchers = {
    toBeWithinEpsilon: function(util, customEqualityTesters) {
        return {
            compare: function(actual,expected) {
                var result={};

                result.pass=fastMath.equal(actual,expected);

                if(result.pass)
                    result.message = "PASSED";
                else
                    result.message = "Expected "+actual+" to be within EPSILON of "+expected;

                return result;
            }
        };
    }
};

describe('Unit: motionProfileFactory testing', function() {
    var motionProfileFactory = require('../lib/profile/motionProfile');
    var accelSegmentFactory = require('../lib/segments/accelSegment');
    var indexSegmentFactory = require('../lib/segments/indexSegment');
    var BasicMotionSegmentFactory=require('../lib/segments/basicSegment');

    var ph = require('../lib/profile/profileHelper');

    beforeEach(function() {
        jasmine.addMatchers(customMatchers);
      });

    it('should create a profile and get extreme values', function () {
        var profile = motionProfileFactory.createMotionProfile("rotary");

        var seg1 = profile.appendSegment(
            motionProfileFactory.createAccelSegment("time-distance", {
                t0: 0,
                tf: 1,
                p0: 0,
                v0: 0,
                pf: 20,
                jPct: 0.5,
                mode: "absolute"
            })
        );


        var seg2 = profile.appendSegment(
            motionProfileFactory.createAccelSegment("time-distance", {
                t0: 1,
                tf: 2,
                p0: seg1.evaluatePositionAt(seg1.finalTime),
                v0: seg1.evaluateVelocityAt(seg1.finalTime),
                pf: 55,
                jPct: 0.5,
                mode: "absolute"
            })
        );

        var seg3 = profile.appendSegment(
            motionProfileFactory.createIndexSegment({
                t0: 0,
                tf: 3.7,
                p0: 0,
                pf: 8,
                v: 0,
                velLimPos: null,
                velLimNeg: null,
                accJerk: 0.7,
                decJerk: 0.4,
                xSkew: null,
                ySkew: null,
                shape: 'trapezoid',
                mode: 'absolute'
            })
        );

        var allbs = profile.getAllBasicSegments();

        var extremes = [];
        allbs.forEach(function (seg) {
            seg.getExtremeValues().forEach(function (mp) {
                extremes.push(mp);
            });
        });

        var extremes2 = [].concat.apply([], profile.getAllSegments().map(function (mSeg) {
            return mSeg.getAllExtremeValues();
        }));
    });

});
