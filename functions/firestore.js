const admin = require('firebase-admin');
admin.firestore.DocumentReference.prototype.toJSON = function () {
    return this.path;
}

admin.initializeApp();

exports.db = admin.firestore();
exports.admin = admin;