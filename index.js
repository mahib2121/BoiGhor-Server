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



let bookCollection;
let ordersCollection;

async function run() {
    try {
        await client.connect();

        const db = client.db("boiGhor");
        bookCollection = db.collection("books");
        ordersCollection = db.collection("orders");

        console.log("MongoDB connected successfully");


        app.get("/books", async (req, res) => {
            const result = await bookCollection.find().toArray();
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

                const amount = Math.round(Number(cost) * 100); // cents

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
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
                });

                res.send({ url: session.url });
            } catch (error) {
                res.status(500).send({ error: error.message });
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
