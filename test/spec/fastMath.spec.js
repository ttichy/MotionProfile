describe('myApp.version module', function() {



  var fm = require('../../lib/util/fastMath');



  describe('fastMath AMD module', function() {
    it('should be loaded', function() {
      expect(fm).toBeDefined();
    });

    it('fastMath isNumeric function should return true when parameters are numbers', function() {
      expect(fm.isNumeric(4.5)).toBe(true);
      expect(fm.isNumeric(-4.5)).toBe(true);
      expect(fm.isNumeric(0)).toBe(true);
      expect(fm.isNumeric(1e-3)).toBe(true);
    });

    it('fastMath isNumeric function should return false when parameters are not numbers', function() {
      expect(fm.isNumeric("4.5a")).toBe(false);
      expect(fm.isNumeric(NaN)).toBe(false);
      expect(fm.isNumeric(undefined)).toBe(false);
      expect(fm.isNumeric(Infinity)).toBe(false);
    });


    it('fastMath areNumeric function should return true when parameters are numbers', function() {
      expect(fm.areNumeric(4.5, -4.5, 0, -1e-4)).toBe(true);
    });



    it('fastMath areNumeric function should return false when a parameter is not a number', function() {
      expect(fm.areNumeric(4.5, -4.5, 0, -1e-4, NaN)).toBe(false);
    });


    it('binary search with accessor should work correctly', function() {

      var data1 = {
        "initialTime": 1
      };
      var data2 = {
        "initialTime": 2
      };

      var data3 = {
        "initialTime": 3
      };

      var testArray = [data1, data2, data3];

      var result = fm.binaryIndexOfObject.call(testArray, 2, function() {
        return this.initialTime;
      });

      expect(result).toBe(1);


      result = fm.binaryIndexOfObject.call(testArray, 3, function() {
        return this.initialTime;
      });
      expect(result).toBe(2);

    });

  });

});