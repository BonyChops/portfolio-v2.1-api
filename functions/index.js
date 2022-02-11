const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const moment = require("moment");
//require("moment/locale/ja");
//moment.locale('ja')
const crypto = require("crypto");
const app = express();
const axios = require("axios");
const bodyParser = require('body-parser');
const { admin, db } = require("./firestore");
const { getAPI } = require("./cacheAPI");
const { ref } = require("firebase-functions/v1/database");

const timezone = 'Asia/Tokyo';
process.env.TZ = timezone;

const whitelist = ['https://bonychops.com'];
const corsOptions = {
    origin: (origin, callback) => {
        if (whitelist.includes(origin) !== -1 || /^http:\/\/localhost/.test(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    }
}
app.use(cors(corsOptions));

let taskNumBuf = 0;

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const getTaskNum = async (id, type) => {
    let taskSnap
    try {
        taskSnap = await db.collection("tasks").where("id", "==", id).where("type", "==", type).limit(1).get();
    } catch (e) {
        console.error(e.data);
        return;
    }
    if (taskSnap.empty) {
        await db.collection("tasks").add({
            id,
            type,
            num: taskNumBuf
        });
        const buf = taskNumBuf;
        taskNumBuf += 1;
        return buf;
    } else {
        console.log("exists");
        return taskSnap.docs[0].data().num;
    }
}

const updateTaskNum = async () => {
    const counterDoc = db.doc("taskNum/taskNum");
    await counterDoc.set({
        num: taskNumBuf
    });
}

const fetchTaskNum = async () => {
    const counterDoc = await db.doc("taskNum/taskNum").get();
    taskNumBuf = counterDoc.exists ? counterDoc.data().num : 1;
}

let rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || 'utf8');
    }
};

app.use(bodyParser.json({ verify: rawBodySaver }));
app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: true }));
app.use(bodyParser.raw({ verify: rawBodySaver, type: '*/*' }));


app.use(async (req, res, next) => {
    console.log("incoming");
    await fetchTaskNum();
    next();
});
/*
app.get("/wip", async (req, res) => {
    let apiResult, subtasksResult
    try {
        apiResult = await getAPI(
            `https://api.todoist.com/rest/v1/tasks?label_id=${functions.config().todoist.label_id}`,
            `Bearer ${functions.config().todoist.token}`,
            1);
        subtasksResult = await getAPI(
            `https://api.todoist.com/rest/v1/tasks?filter=subtask`,
            `Bearer ${functions.config().todoist.token}`,
            1);
    } catch (e) {
        console.error(e);
        return;
    }
    //console.log(apiResult.map(v => v.due));
    console.log(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
    console.log(subtasksResult.filter(v => !v.completed));
    console.log(apiResult);
    //console.log(apiResult.map(v => v.due?.datetime !== undefined ? moment(v.due?.datetime, 'YYYY-MM-DDThh:mm:dd', 'ja').locale('ja') : moment(v.due?.date, 'YYYY-MM-DD', 'ja').locale('ja')));
    const result = await Promise.all(apiResult.filter(v => v.label_ids.includes(Number(functions.config().todoist.label_id))).map(async (v) => ({
        id: await getTaskNum(v.id, "todoist"),
        title: v.content,
        description: v.description,
        due: v.due?.datetime !== undefined ? moment(v.due?.datetime, 'YYYY-MM-DDThh:mm:dd', 'ja').add(1, 'days').subtract(1, "minutes").locale('ja') : moment(v.due?.date, 'YYYY-MM-DD', 'ja').locale('ja')
    })));
    updateTaskNum();
    res.send(result);
    //res.send({test: "test"});
});
*/
app.get("/wip", async (req, res) => {
    console.log(functions.config().todoist.label_id);
    const tasksRef = db.collection("taskDetails").where("type", "==", "todoist").where("completed", "==", false).where("labels", "array-contains", Number(functions.config().todoist.label_id));
    const tasksSnap = await tasksRef.get();
    if(tasksSnap.empty){
        res.send([]);
    }
    console.log(tasksSnap.docs.map(v => v.data()));
    const subtasksRef = db.collection("taskDetails").where("type", "==", "todoist").where("parentId", "in", tasksSnap.docs.map(v => v.data().id));
    const subtasksSnap = await subtasksRef.get();
    const result = tasksSnap.docs.map(v => v.data()).map(v => {
        const secret = v.labels.includes(Number(functions.config().todoist.secret_title_label_id));
        return {
            id: v.publicId,
            title: secret ? "[PRIVATE]" : v.title,
            description: secret ? "[PRIVATE]" : v.description,
            due: v.due === null ? null : v.due.toDate(),
            private: secret,
            recurring: v.recurring === true,
            subtasks: subtasksSnap.docs.map(v => v.data()).filter(vc => vc.parentId === v.id).map(v => ({
                title: secret ? "[PRIVATE]" : v.title,
                completed: v.completed
            }))
        }
    });
    res.send(result);
})

app.get("/completed", async (req, res) => {
    const weakago = moment().subtract(7, 'days');
    const result = await getAPI(
        `https://api.todoist.com/sync/v8/completed/get_all?label_id=${functions.config().todoist.label_id}&since=${weakago.format("YYYY-MM-DDThh:mm")}`,
        `Bearer ${functions.config().todoist.token}`,
        1);
    console.log(result);
    updateTaskNum();
    res.send(result);
});

app.post("/todoist-webhook", async (req, res) => {

    const hash = crypto.createHmac('sha256', functions.config().todoist.client_secret)
        .update(req.rawBody) // <-- this is the needed message to encrypt
        .digest("base64");

    //console.log(req.body);
    console.log("X-Todoist-Hmac-SHA256:", req.header("X-Todoist-Hmac-SHA256"))
    console.log("Hash:", hash);
    if (req.header("X-Todoist-Hmac-SHA256") !== hash) {
        console.error("request rejected");
        res.status(400);
        res.send({ error: "Access Denied" });
        return;
    }
    console.log(req.body);
    const eventData = req.body.event_data;
    const ref = db.collection("taskDetails").where("type", "==", "todoist").where("id", "==", eventData.id).limit(1);
    const snap = await ref.get();
    if (!snap.empty && req.body.event_name === "item:deleted") {
        await db.doc(`tasks/${snap.docs[0].id}`).delete();
    } else {
        const data = {
            id: eventData.id,
            publicId: await getTaskNum(eventData.id, "todoist"),
            title: eventData.content,
            description: eventData.description,
            parentId: eventData.parent_id,
            labels: eventData.labels,
            type: "todoist",
            completed: eventData.checked === 1,
            recurring: eventData.due?.is_recurring === true,
            due: eventData.due === null ? null : (eventData.due?.date.indexOf("T") !== -1 ? moment(eventData.due?.date, 'YYYY-MM-DDThh:mm:dd', 'ja') : moment(eventData.due?.date, 'YYYY-MM-DD', 'ja').locale('ja').add(1, 'days').subtract(1, "seconds").locale('ja'))
        }
        console.log(data);
        if (snap.empty) {
            await db.collection("taskDetails").add(data);
        } else {
            await db.doc(`taskDetails/${snap.docs[0].id}`).update(data);
        }
    }

    res.send();
});

exports.api = functions.region('asia-northeast1').runWith({
    // Ensure the function has enough memory and time
    // to process large files
    timeoutSeconds: 10,
}).https.onRequest(app);