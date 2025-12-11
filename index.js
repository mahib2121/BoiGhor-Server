require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');

app.use(express.json());
app.use(
    cors({
        origin: "http://localhost:5173",
        credentials: true,
    })
);


const port = process.env.PORT || 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yyxeibb.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});



let bookCollection;
let ordersCollection;

async function run() {
    try {
        await client.connect();

        const db = client.db("boiGhor");
        bookCollection = db.collection("books");
        ordersCollection = db.collection("orders");

        console.log("MongoDB connected successfully");

        // ============================
        // BOOK ROUTES
        // ============================

        app.get("/books", async (req, res) => {
            const result = await bookCollection.find().toArray();
            res.send(result);
        });

        app.post("/books", async (req, res) => {
            const result = await bookCollection.insertOne(req.body);
            res.send(result);
        });

        // ============================
        // ORDER ROUTES
        // ============================

        // GET ALL ORDERS
        app.get("/orders", async (req, res) => {
            const query = {};
            const { email } = req.query;

            if (email) {
                query.email = email;
            }

            const result = await ordersCollection.find(query).toArray();
            res.send(result);
        });


        // CREATE ORDER
        app.post("/orders", async (req, res) => {
            const data = req.body;

            const order = {
                userId: data.userId,
                name: data.name,
                email: data.email,
                phone: data.phone,
                address: data.address,
                items: data.items,
                totalAmount: data.totalAmount,
                status: "pending",
                paymentStatus: "unpaid",
                createdAt: new Date()
            };

            const result = await ordersCollection.insertOne(order);
            res.send(result);
        });

    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);

// Root
app.get("/", (req, res) => {
    res.send("Server UP");
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
