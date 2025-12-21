require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE || process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// ================== MIDDLEWARE ==================
app.use(express.json());
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "https://boi-ghor-kappa.vercel.app",
            process.env.SITE_DOMAIN
        ].filter(Boolean),
        credentials: true,
    })
);

// ================== FIREBASE ADMIN (ENV METHOD) ==================
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is missing in .env file");
    }

    const decoded = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT,
        "base64"
    ).toString("utf8");

    const serviceAccount = JSON.parse(decoded);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin Initialized via ENV");
} catch (error) {
    console.error("Firebase Admin Error:", error.message);
}

// ================== AUTH MIDDLEWARE ==================
const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decode = await admin.auth().verifyIdToken(token);
        req.decode_email = decode.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
}

// ================== MONGODB SETUP ==================
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
let paymentsCollection;
let userCollection;

async function run() {
    try {
        //await client.connect();
        const db = client.db("boiGhor");

        // Collections
        bookCollection = db.collection("books");
        ordersCollection = db.collection("orders");
        paymentsCollection = db.collection("payments");
        userCollection = db.collection("users");

        console.log("MongoDB connected successfully");

        // ================== USERS ROUTES ==================

        // 1. CREATE USER
        app.post("/users", verifyFBToken, async (req, res) => {
            const user = req.body;
            if (req.decode_email !== user.email) {
                return res.status(403).send({ message: "Forbidden" });
            }
            const existingUser = await userCollection.findOne({ email: user.email });
            if (existingUser) {
                return res.send({ message: "User already exists" });
            }
            const newUser = {
                email: user.email,
                displayName: user.name,
                photoURL: user.photoURL,
                role: "user",
                createdAt: new Date()
            };
            const result = await userCollection.insertOne(newUser);
            res.send(result);
        });

        // 2. GET ALL USERS
        app.get("/users", verifyFBToken, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // 3. UPDATE USER ROLE (Admin Only)
        app.patch('/users/role/:id', verifyFBToken, async (req, res) => {
            const requesterEmail = req.decode_email;
            const { role } = req.body;
            const id = req.params.id;

            const allowedRoles = ["user", "librarian", "admin"];
            if (!allowedRoles.includes(role)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            const requester = await userCollection.findOne({ email: requesterEmail });
            if (requester?.role !== "admin") {
                return res.status(403).send({ message: "Forbidden" });
            }

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );
            res.send(result);
        });

        // 4. DELETE USER
        app.delete('/users/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        // 5. GET USER ROLE
        app.get('/users/role/:email', verifyFBToken, async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });
            let role = 'user';
            if (user && user.role) {
                role = user.role;
            }
            res.send({ role });
        });

        // 6. GET CURRENT USER PROFILE
        app.get("/users/profile", verifyFBToken, async (req, res) => {
            const email = req.decode_email;
            const user = await userCollection.findOne({ email });
            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }
            res.send(user);
        });

        // 7. UPDATE CURRENT USER PROFILE
        app.patch("/users/profile", verifyFBToken, async (req, res) => {
            const email = req.decode_email;
            const { displayName, photoURL } = req.body;
            const result = await userCollection.updateOne(
                { email },
                {
                    $set: {
                        displayName,
                        photoURL,
                        updatedAt: new Date()
                    }
                }
            );
            res.send(result);
        });

        // ================== BOOKS ROUTES ==================

        // GET ALL BOOKS
        app.get("/books", async (req, res) => {
            const result = await bookCollection.find().toArray();
            res.send(result);
        });

        // GET ONE BOOK
        app.get("/books/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bookCollection.findOne(query);
            res.send(result);
        });

        // ADD BOOK
        app.post("/books", verifyFBToken, async (req, res) => {
            const item = req.body;
            const result = await bookCollection.insertOne(item);
            res.send(result);
        });

        // UPDATE BOOK
        app.patch("/books/:id", verifyFBToken, async (req, res) => {
            const email = req.decode_email;
            const id = req.params.id;
            const item = req.body;

            const user = await userCollection.findOne({ email });
            if (!user) {
                return res.status(403).send({ message: "Forbidden" });
            }

            const book = await bookCollection.findOne({ _id: new ObjectId(id) });

            // Authorization Check
            if (user.role !== "admin" && book.librarianEmail !== email) {
                return res.status(403).send({ message: "Unauthorized" });
            }

            const updatedDoc = {
                $set: {
                    title: item.title,
                    description: item.description,
                    category: item.category,
                    coverImage: item.coverImage,
                    oldPrice: item.oldPrice,
                    newPrice: item.newPrice,
                    trending: item.trending
                }
            };

            const result = await bookCollection.updateOne(
                { _id: new ObjectId(id) },
                updatedDoc
            );
            res.send(result);
        });

        // DELETE BOOK
        app.delete('/books/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await bookCollection.deleteOne(query);
            res.send(result);
        });

        // ================== ORDERS ROUTES ==================

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

        // GET SINGLE ORDER
        app.get("/orders/:id", async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await ordersCollection.findOne(query);
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

        // CANCEL ORDER
        app.patch('/orders/:id/cancel', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const order = await ordersCollection.findOne(query);

                if (!order) {
                    return res.status(404).send({ success: false, message: 'Order not found' });
                }
                if (order.paymentStatus === 'paid') {
                    return res.status(400).send({
                        success: false,
                        message: 'Paid orders cannot be cancelled'
                    });
                }

                const update = {
                    $set: {
                        status: 'cancelled',
                        cancelledAt: new Date()
                    }
                };
                await ordersCollection.updateOne(query, update);
                res.send({
                    success: true,
                    message: 'Order cancelled successfully'
                });
            } catch (error) {
                res.status(500).send({ success: false, error: error.message });
            }
        });

        // UPDATE ORDER STATUS
        app.patch('/orders/:id/status', async (req, res) => {
            const { status } = req.body;
            const id = req.params.id;
            const result = await ordersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );
            res.send(result);
        });

        // ================== STRIPE PAYMENT ROUTES ==================

        // CREATE CHECKOUT SESSION
        app.post('/payment-checkout-session', async (req, res) => {
            try {
                const { cost, orderId, name, email } = req.body;
                const amount = Math.round(Number(cost) * 100);

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                unit_amount: amount,
                                product_data: {
                                    name: name || 'Order Payment',
                                },
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    customer_email: email,
                    metadata: {
                        orderId: orderId
                    },
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
                });
                res.send({ url: session.url });
            } catch (error) {
                res.status(500).send({ error: error.message });
            }
        });

        // HANDLE PAYMENT SUCCESS
        app.patch('/payment-success', async (req, res) => {
            try {
                const { session_id } = req.query;
                if (!session_id) {
                    return res.status(400).send({ success: false, message: 'session_id missing' });
                }

                const session = await stripe.checkout.sessions.retrieve(session_id);
                if (session.payment_status !== 'paid') {
                    return res.status(400).send({ success: false, message: 'Payment not completed' });
                }

                const orderId = session.metadata?.orderId;
                const paymentIntentId = session.payment_intent;

                if (!orderId || !paymentIntentId) {
                    return res.status(400).send({ success: false, message: 'Invalid payment metadata' });
                }

                const alreadyPaid = await paymentsCollection.findOne({
                    paymentId: paymentIntentId
                });

                if (alreadyPaid) {
                    return res.send({
                        success: true,
                        message: 'Payment already processed',
                        paymentId: paymentIntentId
                    });
                }

                await ordersCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    {
                        $set: {
                            paymentStatus: 'paid',
                            transactionId: paymentIntentId
                        }
                    }
                );

                const paymentDoc = {
                    orderId: new ObjectId(orderId),
                    email: session.customer_email || null,
                    paymentId: paymentIntentId,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    status: session.payment_status,
                    createdAt: new Date()
                };

                await paymentsCollection.insertOne(paymentDoc);

                res.send({
                    success: true,
                    message: 'Payment recorded successfully',
                    paymentId: paymentIntentId
                });

            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });

        // GET PAYMENTS
        app.get("/payments", verifyFBToken, async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) {
                    return res.status(400).send({ message: "Email is required Or Unauthorized access" });
                }
                const result = await paymentsCollection
                    .find({ email })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
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

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

// EXPORT THE APP FOR VERCEL
module.exports = app;