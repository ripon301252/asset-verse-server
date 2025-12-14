require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// MongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w0nmtjl.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1 },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("asset_verse_db");
    const assetCollection = db.collection("asset_list");
    const assetRequestCollection = db.collection("asset_requests");
    const usersCollection = db.collection("users");

    console.log("MongoDB connected!");

    // =====================================================
    // USERS - SINGLE ROUTE (Fixed)
    // =====================================================

    app.post("/users", async (req, res) => {
      const user = req.body;

      // already exists check
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }

      // ⭐ HR default package logic (IMPORTANT)
      if (user.role === "hr") {
        user.package = "basic";
        user.packageLimit = 5;
        user.createdAt = new Date();
      }

      if (user.role === "employee") {
        user.createdAt = new Date();
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/requests/approve/:id", async (req, res) => {
      const requestId = req.params.id;
      const { hrEmail, employeeEmail, assetId } = req.body;

      // 1️⃣ HR info
      const hr = await usersCollection.findOne({ email: hrEmail });

      // 2️⃣ Current employee count
      const currentEmployees =
        await employeeAffiliationsCollection.countDocuments({
          companyEmail: hrEmail,
        });

      // 3️⃣ Package limit check
      if (currentEmployees >= hr.packageLimit) {
        return res.status(403).send({
          message: "Employee limit reached. Please upgrade package.",
        });
      }

      // 4️⃣ Approve request
      await requestsCollection.updateOne(
        { _id: new ObjectId(requestId) },
        { $set: { status: "approved" } }
      );

      // 5️⃣ Auto employee affiliation (first time)
      const alreadyAffiliated = await employeeAffiliationsCollection.findOne({
        employeeEmail,
        companyEmail: hrEmail,
      });

      if (!alreadyAffiliated) {
        await employeeAffiliationsCollection.insertOne({
          employeeEmail,
          companyEmail: hrEmail,
          companyName: hr.companyName,
          joinedAt: new Date(),
        });
      }

      // 6️⃣ Asset quantity reduce
      await assetsCollection.updateOne(
        { _id: new ObjectId(assetId) },
        { $inc: { quantity: -1 } }
      );

      res.send({ success: true });
    });

    // Get role
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch user data" });
      }
    });

    // Get all users
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.json(users);
    });

    app.delete("/affiliations/:employeeId", async (req, res) => {
      const { employeeId } = req.params;
      const { companyName } = req.body; // client থেকে পাঠাতে হবে
      if (!companyName)
        return res.status(400).json({ message: "Company required" });

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(employeeId) },
          {
            $pull: {
              affiliations: {
                companyName: { $regex: `^${companyName}$`, $options: "i" },
              },
            },
          }
        );

        res.json({ success: result.modifiedCount > 0 });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to remove affiliation" });
      }
    });

    // GET single user
    app.get("/users/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      try {
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch employee data" });
      }
    });

    app.put("/users/:id", async (req, res) => {
      const { id } = req.params;
      const { name, email, role, photoURL, companyName } = req.body;

      try {
        const updateDoc = {
          $set: {
            name,
            email,
            role,
            photoURL,
          },
        };

        // HR এর companyName update করতে চাইলে
        if (role === "hr" && companyName) {
          updateDoc.$set.companyName = companyName;
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        if (result.modifiedCount > 0) {
          res.json({ success: true, message: "Employee updated successfully" });
        } else {
          res.json({ success: false, message: "No changes made" });
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Update failed" });
      }
    });

    // =====================================================
    // EMPLOYEES
    // =====================================================
    app.get("/employees", async (req, res) => {
      const { company, page = 1, limit = 10, search = "" } = req.query;

      if (!company)
        return res.status(400).json({ message: "Company is required" });

      const skip = (page - 1) * limit;
      const regex = new RegExp(search, "i");

      const query = {
        role: "employee",
        affiliations: {
          $elemMatch: {
            companyName: { $regex: `^${company}$`, $options: "i" },
          },
        },
        $or: [{ name: regex }, { email: regex }],
      };

      const total = await usersCollection.countDocuments(query);
      const employees = await usersCollection
        .find(query)
        .skip(Number(skip))
        .limit(Number(limit))
        .toArray();

      res.json({ employees, total });
    });

    // Add affiliation
    app.post("/affiliations/:id", async (req, res) => {
      const { id } = req.params;
      const { companyName } = req.body;

      await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $addToSet: {
            affiliations: {
              companyName: companyName.toLowerCase(),
              joinedAt: new Date(),
            },
          },
        }
      );

      res.json({ success: true });
    });

    // =====================================================
    // ASSETS
    // =====================================================
    app.get("/assets", async (req, res) => {
      const { page = 1, limit = 10, search = "", type } = req.query;

      const skip = (page - 1) * limit;

      const query = {};

      if (search) query.name = { $regex: search, $options: "i" };
      if (type) query.type = type;

      try {
        const total = await assetCollection.countDocuments(query);
        const assets = await assetCollection
          .find(query)
          .skip(Number(skip))
          .limit(Number(limit))
          .toArray();

        res.json({ assets, total });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch assets" });
      }
    });

    // Get single asset by id
    app.get("/assets/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const asset = await assetCollection.findOne({ _id: new ObjectId(id) });
        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset); // return the asset
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch asset data" });
      }
    });

    app.post("/assets", async (req, res) => {
      const asset = req.body;
      asset.name = asset.name.toLowerCase().trim();
      const result = await assetCollection.insertOne(asset);
      res.status(201).json(result);
    });

    app.put("/assets/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
      }

      try {
        const result = await assetCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: req.body }
        );

        res.json({
          success: true,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          success: false,
          message: "Asset update failed",
        });
      }
    });

    app.delete("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const result = await assetCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json({ deletedCount: result.deletedCount });
    });

    // =====================================================
    // chart
    // =====================================================

    // PIE chart: Returnable vs Non-Returnable assets
    app.get("/api/dashboard/pie", async (req, res) => {
      try {
        const data = await assetCollection
          .aggregate([
            {
              $group: {
                _id: "$type", // type field in asset document: "returnable" / "non-returnable"
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();
        res.json(data);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to get pie chart data" });
      }
    });

    // BAR chart: Top 5 requested assets
    app.get("/api/dashboard/bar", async (req, res) => {
      try {
        const data = await assetRequestCollection
          .aggregate([
            {
              $group: {
                _id: "$assetName",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray();
        res.json(data);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to get bar chart data" });
      }
    });

    // =====================================================
    // ASSET REQUESTS
    // =====================================================
    app.get("/asset_requests", async (req, res) => {
      const { email, page = 1, limit = 10 } = req.query;
      const query = email ? { email } : {};
      const skip = (page - 1) * limit;

      try {
        const total = await assetRequestCollection.countDocuments(query);
        const requests = await assetRequestCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(Number(skip))
          .limit(Number(limit))
          .toArray();

        res.json({ requests, total });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch asset requests" });
      }
    });

    app.post("/asset_requests", async (req, res) => {
      const { assetId, quantity, userName, email, reason } = req.body;

      const asset = await assetCollection.findOne({
        _id: new ObjectId(assetId),
      });

      if (!asset) return res.status(400).json({ message: "Asset not found" });

      const request = {
        assetId,
        assetName: asset.name,
        quantity,
        status: "pending",
        userName,
        email,
        reason,
        createdAt: new Date(),
      };

      const result = await assetRequestCollection.insertOne(request);
      res.status(201).json(result);
    });

    // Approve asset request
    app.put("/asset_requests/:id/approve", async (req, res) => {
      const requestId = req.params.id;
      const { hrEmail, employeeEmail, assetId } = req.body;

      try {
        // 1️⃣ HR info
        const hr = await usersCollection.findOne({ email: hrEmail });
        if (!hr) return res.status(404).json({ message: "HR not found" });

        // 2️⃣ Current employee count in HR company
        const currentEmployees = await usersCollection.countDocuments({
          role: "employee",
          affiliations: { $elemMatch: { companyName: hr.companyName } },
        });

        // 3️⃣ Package limit check
        if (currentEmployees >= hr.packageLimit) {
          return res
            .status(403)
            .json({ message: "Employee limit reached. Upgrade package!" });
        }

        // 4️⃣ Approve request
        await assetRequestCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "approved" } }
        );

        // 5️⃣ Auto employee affiliation (first time)
        const employee = await usersCollection.findOne({
          email: employeeEmail,
        });
        const alreadyAffiliated = employee.affiliations?.some(
          (aff) => aff.companyName === hr.companyName
        );

        if (!alreadyAffiliated) {
          await usersCollection.updateOne(
            { email: employeeEmail },
            {
              $addToSet: {
                affiliations: {
                  companyName: hr.companyName,
                  joinedAt: new Date(),
                },
              },
            }
          );
        }

        // 6️⃣ Reduce asset quantity
        await assetCollection.updateOne(
          { _id: new ObjectId(assetId) },
          { $inc: { quantity: -1 } }
        );

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to approve request" });
      }
    });

    // Reject asset request
    app.put("/asset_requests/:id/reject", async (req, res) => {
      const requestId = req.params.id;

      try {
        // Update request status to "rejected"
        const result = await assetRequestCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "rejected" } }
        );

        if (result.modifiedCount > 0) {
          res.json({ success: true, message: "Request rejected" });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ success: false, message: "Failed to reject request" });
      }
    });

    // DELETE asset request
    app.delete("/asset_requests/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid request ID" });

      try {
        const result = await assetRequestCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json({ deletedCount: result.deletedCount });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete asset request" });
      }
    });

    //  strip Create Checkout Session
    app.post("/api/stripe/create-checkout-session", async (req, res) => {
      try {
        const { hrId, packageType, amount } = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: `AssetVerse ${packageType} Package` },
                unit_amount: amount * 100,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-success?session_id={CHECKOUT_SESSION_ID}&hrId=${hrId}&packageType=${packageType}`,
          cancel_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-cancel`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Stripe session creation failed" });
      }
    });

    // Verify Payment & Update HR Package (dummy DB)
    let HR_DB = [];

    app.get("/api/stripe/success", async (req, res) => {
      const { session_id, hrId, packageType } = req.query;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status === "paid") {
          // Update package in dummy DB
          let packageLimit = 5;
          if (packageType === "Standard") packageLimit = 20;
          if (packageType === "Premium") packageLimit = 50;

          // Update HR DB
          let hr = HR_DB.find((h) => h.id === hrId);
          if (hr) {
            hr.packageType = packageType;
            hr.packageLimit = packageLimit;
          } else {
            HR_DB.push({ id: hrId, packageType, packageLimit });
          }

          return res.json({ success: true, packageType, packageLimit });
        }

        res.json({ success: false });
      } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error verifying payment." });
      }
    });

    // Mongo ping
    await client.db("admin").command({ ping: 1 });
    console.log("Ping OK");
  } finally {
  }
}

run().catch(console.dir);

// HOME
app.get("/", (req, res) => res.send("AssetVerse Backend Running!"));

// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));
