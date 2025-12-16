require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE)
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
const verifyFBToken = (req, res, next) => {
    console.log('heders', req.headers.authorization);
    next()
}





let bookCollection;
let ordersCollection;
let paymentsCollection;

async function run() {
    try {
        await client.connect();

        const db = client.db("boiGhor");
        bookCollection = db.collection("books");
        ordersCollection = db.collection("orders");
        paymentsCollection = db.collection("payments");

        console.log("MongoDB connected successfully");


        app.get("/books", async (req, res) => {
            const result = await bookCollection.find().toArray();
            res.send(result);
        });

        app.get("/books/:id", async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await bookCollection.findOne(query);
            res.send(result);
        });

        app.post("/books", async (req, res) => {
            const result = await bookCollection.insertOne(req.body);
            res.send(result);
        });

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

        //pyament gatway stripe 

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

        app.patch('/payment-success', async (req, res) => {
            try {
                const { session_id } = req.query;

                if (!session_id) {
                    return res.status(400).send({
                        success: false,
                        message: 'session_id missing'
                    });
                }


                const session = await stripe.checkout.sessions.retrieve(session_id);

                if (session.payment_status !== 'paid') {
                    return res.status(400).send({
                        success: false,
                        message: 'Payment not completed'
                    });
                }

                const orderId = session.metadata?.orderId;
                const paymentIntentId = session.payment_intent;

                if (!orderId || !paymentIntentId) {
                    return res.status(400).send({
                        success: false,
                        message: 'Invalid payment metadata'
                    });
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
                res.status(500).send({
                    success: false,
                    message: error.message
                });
            }
        });


        app.get("/payments", verifyFBToken, async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Email is required Or Unauthorize access " });
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
