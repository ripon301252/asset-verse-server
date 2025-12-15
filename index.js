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
    const employeeAffiliationsCollection = db.collection(
      "employeeAffiliations"
    );

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

    // app.delete("/affiliations/:employeeId", async (req, res) => {
    //   const { employeeId } = req.params;
    //   const { companyName } = req.body; // client থেকে পাঠাতে হবে
    //   if (!companyName)
    //     return res.status(400).json({ message: "Company required" });

    //   try {
    //     const result = await usersCollection.updateOne(
    //       { _id: new ObjectId(employeeId) },
    //       {
    //         $pull: {
    //           affiliations: {
    //             companyName: { $regex: `^${companyName}$`, $options: "i" },
    //           },
    //         },
    //       }
    //     );

    //     res.json({ success: result.modifiedCount > 0 });
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Failed to remove affiliation" });
    //   }
    // });




    // GET single user
    
    app.delete("/affiliations/:affiliationId", async (req, res) => {
  const { affiliationId } = req.params;
  const hrEmail = req.headers.hremail;

  if (!hrEmail) return res.status(400).json({ message: "HR email required" });

  // HR এর company বের করা
  const hr = await usersCollection.findOne({ email: hrEmail, role: "hr" });
  if (!hr) return res.status(404).json({ message: "HR not found" });

  try {
    const result = await employeeAffiliationsCollection.deleteOne({
      _id: new ObjectId(affiliationId),
      companyName: hr.companyName
    });

    if (result.deletedCount > 0) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: "Employee affiliation not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove employee" });
  }
});

    
    
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

    // =====================================================
    // HR EMPLOYEE LIST
    // =====================================================
    app.get("/hr/employees", async (req, res) => {
      const { page = 1, limit = 10, search = "" } = req.query;
      const hrEmail = req.headers.hremail; // frontend থেকে পাঠানো HR email

      if (!hrEmail)
        return res.status(400).json({ message: "HR email required" });

      try {
        // 1️⃣ HR এর company বের করা
        const hr = await usersCollection.findOne({
          email: hrEmail,
          role: "hr",
        });
        if (!hr) return res.status(404).json({ message: "HR not found" });

        const companyName = hr.companyName;

        // 2️⃣ Employee affiliations query
        const query = { companyName, status: "active" };
        if (search) {
          query.employeeEmail = { $regex: search, $options: "i" };
        }

        const total = await employeeAffiliationsCollection.countDocuments(
          query
        );

        const affiliations = await employeeAffiliationsCollection
          .find(query)
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .toArray();

        // 3️⃣ User info join
        const employeeIds = affiliations.map((a) => new ObjectId(a.employeeId));
        const employees = await usersCollection
          .find({ _id: { $in: employeeIds } })
          .project({ name: 1, email: 1, photoURL: 1 })
          .toArray();

        // Attach affiliationId and joinedAt for frontend
        const finalEmployees = affiliations.map((aff) => {
          const user = employees.find(
            (u) => u._id.toString() === aff.employeeId.toString()
          );
          return {
            affiliationId: aff._id,
            employeeId: aff.employeeId,
            name: user?.name || "Unknown",
            email: aff.employeeEmail,
            photoURL: user?.photoURL || "",
            status: aff.status,
            joinedAt: aff.joinedAt,
          };
        });

        res.json({ employees: finalEmployees, total });
      } catch (err) {
        console.error("HR EMPLOYEE LIST ERROR:", err);
        res.status(500).json({ message: "Failed to fetch employees" });
      }
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

    // Return asset
    app.put("/asset_requests/:id/return", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid request ID" });

      try {
        // 1️⃣ Update request status
        const result = await assetRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "returned" } }
        );

        if (result.modifiedCount === 0)
          return res
            .status(404)
            .json({ success: false, message: "Request not found" });

        // 2️⃣ Optionally increase asset quantity back
        const request = await assetRequestCollection.findOne({
          _id: new ObjectId(id),
        });
        if (request.assetId) {
          await assetCollection.updateOne(
            { _id: new ObjectId(request.assetId) },
            { $inc: { quantity: 1 } }
          );
        }

        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ success: false, message: "Failed to return asset" });
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
      const { hrEmail, employeeEmail, assetId, quantityNeeded } = req.body;

      try {
        // 1️⃣ HR check
        const hr = await usersCollection.findOne({ email: hrEmail });
        if (!hr) {
          return res
            .status(404)
            .json({ success: false, message: "HR not found" });
        }

        // 2️⃣ Package limit check
        const employeeCount =
          await employeeAffiliationsCollection.countDocuments({
            companyName: hr.companyName,
            status: "active",
          });

        if (employeeCount >= hr.packageLimit) {
          return res.status(403).json({
            success: false,
            message: "Employee limit reached. Please upgrade package.",
          });
        }

        // 3️⃣ Request approve
        const approveResult = await assetRequestCollection.updateOne(
          { _id: new ObjectId(requestId), status: "pending" },
          { $set: { status: "approved", approvedAt: new Date() } }
        );

        if (approveResult.modifiedCount === 0) {
          return res.status(400).json({
            success: false,
            message: "Request already approved or not found",
          });
        }

        // 4️⃣ Employee check
        const employee = await usersCollection.findOne({
          email: employeeEmail,
        });
        if (!employee) {
          return res.status(404).json({
            success: false,
            message: "Employee not found",
          });
        }

        // 5️⃣ Auto affiliation
        const exists = await employeeAffiliationsCollection.findOne({
          employeeId: employee._id,
          companyName: hr.companyName,
        });

        if (!exists) {
          await employeeAffiliationsCollection.insertOne({
            employeeId: employee._id,
            employeeEmail,
            companyName: hr.companyName,
            hrEmail,
            status: "active",
            joinedAt: new Date(),
          });
        }

        // 6️⃣ Asset quantity check
        const asset = await assetCollection.findOne({
          _id: new ObjectId(assetId),
        });

        if (!asset || asset.quantity < 1) {
          return res.status(400).json({
            success: false,
            message: "Asset out of stock",
          });
        }

        // 7️⃣ Reduce asset quantity
        await assetCollection.updateOne(
          { _id: new ObjectId(assetId) },
          { $inc: { quantity: -quantityNeeded } }
        );

        res.json({ success: true });
      } catch (err) {
        console.error("APPROVE ERROR:", err);
        res.status(500).json({
          success: false,
          message: "Failed to approve request",
        });
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
        const { hrEmail, packageType, amount } = req.body;
        console.log(hrEmail)
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
          success_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-success?session_id={CHECKOUT_SESSION_ID}&hrEmail=${hrEmail}&packageType=${packageType}`,
          cancel_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-cancel`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Stripe session creation failed" });
      }
    });


    
// ✅ Create Stripe Checkout Session
// app.post("/api/stripe/create-checkout-session", async (req, res) => {
//   const { hrId, packageType, amount } = req.body;

//   if (!hrId || !packageType || !amount)
//     return res.status(400).json({ error: "Missing parameters" });

//   try {
//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ["card"],
//       line_items: [
//         {
//           price_data: {
//             currency: "usd",
//             product_data: { name: `AssetVerse ${packageType} Package` },
//             unit_amount: amount * 100, // cents
//           },
//           quantity: 1,
//         },
//       ],
//       mode: "payment",
//       success_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-success?session_id=${session.id}&hrId=${hrId}&packageType=${packageType}`,
//       cancel_url: `${process.env.CLIENT_URL}/packageUpgrade/upgrade-cancel`,
//     });

//     res.json({ url: session.url });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Stripe session creation failed" });
//   }
// });

 

// Verify Payment & Update HR Package
app.get("/api/stripe/success", async (req, res) => {
  const { session_id, hrEmail, packageType } = req.query;

  if (!session_id || !hrEmail || !packageType) {
    return res.status(400).json({ error: "Missing query parameters" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Payment not completed" });
    }

    // Set package limits
    let packageLimit = 5; // default
    if (packageType === "Standard") packageLimit = 20;
    if (packageType === "Premium") packageLimit = 50;

    // Update HR in DB
    await usersCollection.updateOne(
      { email: hrEmail},
      {
        $set: {
          package: packageType,
          packageLimit: packageLimit,
        },
      }
    );

    return res.json({ success: true, packageType, packageLimit });
  } catch (err) {
    console.error("Stripe success verification error:", err);
    res.status(500).json({ error: "Error verifying payment." });
  }
});


// ✅ Verify payment & update HR package
// app.get("/api/stripe/success", async (req, res) => {
//   const { session_id, hrId, packageType } = req.query;

//   if (!session_id || !hrId || !packageType) {
//     return res.status(400).json({ error: "Missing query parameters" });
//   }

//   try {
//     const session = await stripe.checkout.sessions.retrieve(session_id);

//     if (session.payment_status !== "paid") {
//       return res.status(400).json({ success: false, message: "Payment not completed" });
//     }

//     // Set package limits
//     let packageLimit = 5;
//     if (packageType === "Standard") packageLimit = 20;
//     if (packageType === "Premium") packageLimit = 50;

//     // Update HR in DB
//     await usersCollection.updateOne(
//       { _id: new ObjectId(hrId) },
//       { $set: { package: packageType, packageLimit } }
//     );

//     res.json({ success: true, packageType, packageLimit });
//   } catch (err) {
//     console.error("Stripe success verification error:", err);
//     res.status(500).json({ error: "Error verifying payment." });
//   }
// });


    

    app.get("/api/stripe/success", async (req, res) => {
  const { session_id, hrId, packageType } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {

      // ⭐ packageLimit ঠিকমতো define করা
      let packageLimit = 5;
      if (packageType === "Standard") packageLimit = 20;
      if (packageType === "Premium") packageLimit = 50;

      await usersCollection.updateOne(
        { _id: new ObjectId(hrId) },
        {
          $set: {
            package: packageType,
            packageLimit: packageLimit, // ✅ এখন ঠিক আছে
          },
        }
      );

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
