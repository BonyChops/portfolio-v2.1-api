const axios = require("axios");
const { admin, db } = require("./firestore");
const moment = require("moment");

const fetchAPI = async (options, spanTime) => {
    const ref = db.collection("apiCache").where("options", "==", JSON.stringify(options));
    const snap = await ref.limit(1).get();
    if (snap.empty || moment.duration(moment().diff(moment(snap.docs[0].data().occurredTime.toDate()))).asMinutes() >= spanTime) {
        const apiResult = await axios(options);
        if (snap.empty) {
            db.collection("apiCache").add({
                occurredTime: new Date(),
                options: JSON.stringify(options),
                apiResult: JSON.stringify(apiResult.data)
            });
        } else {
            console.log(snap.docs[0].id);
            await db.doc(`apiCache/${snap.docs[0].id}`).update({
                occurredTime: new Date(),
                apiResult: JSON.stringify(apiResult.data)
            });
        }
        console.log("calling api");
        return apiResult.data;
    }else{
        console.log("using cache!");
        return JSON.parse(snap.docs[0].data().apiResult);
    }
}

const getAPI = async (url, authorization = undefined, spanTime) => {
    return await fetchAPI({
        method: 'get',
        url,
        headers: {
            Authorization: authorization
        }
    }, spanTime);
}

exports.getAPI = getAPI;
exports.fetchAPI = fetchAPI;