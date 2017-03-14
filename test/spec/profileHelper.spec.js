describe('Unit: profile helper functions-', function() {
  var polynomialFactory = require('../../util/polynomial');
  var basicSegmentFactory = require('../../segments/basicSegment');
  var accelSegmentFactory = require('../../segments/accelSegment');
  var ph = require('../../segments/profileHelper');
  var motionProfileFactory = require('../../profile/motionProfile');



  it('profile helper should validate basic segments in a valid profile', function() {
    var profile = motionProfileFactory.createMotionProfile("rotary");

    var accelSegment = accelSegmentFactory.MakeFromTimeVelocity(0, 2, 0, 0, 10, 0.5);

    profile.appendSegment(accelSegment);

    accelSegment = accelSegmentFactory.MakeFromTimeVelocity(2, 4, 10, 10, 0, 0.5);

    profile.appendSegment(accelSegment);

    ph.validateBasicSegments(profile.getAllBasicSegments());


  });



});