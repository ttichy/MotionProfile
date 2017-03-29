var MotionProfile = require('./profile/motionProfile.js');


if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
	// AMD. Register as an anonymous module.
	define(function() {
		return MotionProfile;
	});
} else if (typeof module !== 'undefined' && module.exports) {
	module.exports = MotionProfile;
} else {
	window.MotionProfile = MotionProfile;
}


