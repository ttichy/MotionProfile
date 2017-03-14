/**
 * Create MotionProfile new Class instance.
 *
 * Options
 * @class Represents a MotionProfile
 * @param arg1
 */
function MotionProfile() { //Constructor
    this.publicPropery = 'public value'; //set public property

}

/**
 * public function
 */

MotionProfile.prototype.publicFunction = function() {
    console.log(this.publicPropery); //get public property (can also be accessed also from outside)
    console.log(privateProperty); //get private property
};

/**
 * Private function
 */

function privateFunction() {

}

var privateProperty = 'private value'; //set private property

module.exports = new MotionProfile(); //Instantiate the Object