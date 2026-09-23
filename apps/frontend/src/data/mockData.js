// Centralized mock data. Every "service" in /src/services reads from here.
// When the backend is ready, swap the function bodies in /src/services
// for real fetch/axios calls — nothing else in the app needs to change.

export const currentUser = {
  id: "u_001",
  name: "Dr. Sarah Johnson",
  role: "Admin",
  hospital: "City Hospital",
  avatar:
    "https://images.unsplash.com/photo-1594824476967-48c8b964273f?q=80&w=200&auto=format&fit=crop",
};

export const stats = {
  totalMedicines: { value: 1243, delta: 12.5, trend: "up" },
  totalValue: { value: 24850, delta: 8.2, trend: "up" },
  expiringSoon: { value: 28, window: "30 days" },
  activeExchanges: { value: 15, label: "In progress" },
};

export const inventoryOverview = [
  { day: "Mon", stockIn: 620, stockOut: 210 },
  { day: "Tue", stockIn: 640, stockOut: 340 },
  { day: "Wed", stockIn: 720, stockOut: 260 },
  { day: "Thu", stockIn: 610, stockOut: 480 },
  { day: "Fri", stockIn: 810, stockOut: 350 },
  { day: "Sat", stockIn: 700, stockOut: 460 },
  { day: "Sun", stockIn: 760, stockOut: 300 },
];

export const medicineCategories = [
  { name: "Antibiotics", value: 35, color: "#233A5C" },
  { name: "Pain Relief", value: 25, color: "#0E8C82" },
  { name: "Vitamins", value: 20, color: "#26A596" },
  { name: "Others", value: 20, color: "#E8A23D" },
];

export const medicines = [
  {
    id: "m_001",
    name: "Amoxicillin 500mg",
    category: "Antibiotics",
    batch: "AMX-2405",
    quantity: 150,
    unit: "boxes",
    expiry: "2024-05-25",
    status: "Low Stock",
    hospital: "City Hospital",
  },
  {
    id: "m_002",
    name: "Paracetamol 650mg",
    category: "Pain Relief",
    batch: "PCM-1187",
    quantity: 300,
    unit: "boxes",
    expiry: "2024-06-01",
    status: "In Stock",
    hospital: "City Hospital",
  },
  {
    id: "m_003",
    name: "Cetirizine 10mg",
    category: "Antihistamine",
    batch: "CTZ-0932",
    quantity: 200,
    unit: "boxes",
    expiry: "2024-06-07",
    status: "In Stock",
    hospital: "City Hospital",
  },
  {
    id: "m_004",
    name: "Vitamin C 500mg",
    category: "Vitamins",
    batch: "VTC-4471",
    quantity: 100,
    unit: "boxes",
    expiry: "2024-07-15",
    status: "In Stock",
    hospital: "City Hospital",
  },
  {
    id: "m_005",
    name: "Insulin Glargine",
    category: "Hormones",
    batch: "INS-7723",
    quantity: 40,
    unit: "vials",
    expiry: "2024-08-02",
    status: "Critical",
    hospital: "City Hospital",
  },
  {
    id: "m_006",
    name: "Ibuprofen 400mg",
    category: "Pain Relief",
    batch: "IBU-3391",
    quantity: 260,
    unit: "boxes",
    expiry: "2024-09-18",
    status: "In Stock",
    hospital: "City Hospital",
  },
];

export const expiryAlerts = [
  {
    id: "e_001",
    medicine: "Amoxicillin 500mg",
    daysLeft: 5,
    expiry: "25 May 2024",
    severity: "Low Stock",
  },
  {
    id: "e_002",
    medicine: "Paracetamol 650mg",
    daysLeft: 12,
    expiry: "01 Jun 2024",
    severity: "Low Stock",
  },
  {
    id: "e_003",
    medicine: "Cetirizine 10mg",
    daysLeft: 18,
    expiry: "07 Jun 2024",
    severity: "Medium Stock",
  },
];

export const recentActivity = [
  {
    id: "a_001",
    type: "exchange",
    text: "New exchange request from Green Hospital",
    time: "2 hours ago",
  },
  {
    id: "a_002",
    type: "inventory",
    text: "Amoxicillin 500mg stock updated",
    time: "5 hours ago",
  },
  {
    id: "a_003",
    type: "inventory",
    text: "Paracetamol 650mg added to inventory",
    time: "1 day ago",
  },
  {
    id: "a_004",
    type: "success",
    text: "Exchange request completed",
    time: "2 days ago",
  },
];

export const hospitals = [
  {
    id: "h_001",
    name: "Green Hospital",
    location: "Lalitpur",
    type: "General",
    activeExchanges: 3,
    rating: 4.6,
  },
  {
    id: "h_002",
    name: "Sunrise Medical Center",
    location: "Bhaktapur",
    type: "Specialty",
    activeExchanges: 1,
    rating: 4.2,
  },
  {
    id: "h_003",
    name: "Valley Community Clinic",
    location: "Kathmandu",
    type: "Clinic",
    activeExchanges: 2,
    rating: 4.8,
  },
  {
    id: "h_004",
    name: "Northfield Hospital",
    location: "Kathmandu",
    type: "General",
    activeExchanges: 0,
    rating: 4.0,
  },
];

export const exchangeRequests = [
  {
    id: "x_001",
    direction: "incoming",
    medicine: "Amoxicillin 500mg",
    quantity: 60,
    unit: "boxes",
    fromHospital: "Green Hospital",
    toHospital: "City Hospital",
    status: "Pending",
    requestedOn: "2024-05-14",
  },
  {
    id: "x_002",
    direction: "outgoing",
    medicine: "Vitamin C 500mg",
    quantity: 40,
    unit: "boxes",
    fromHospital: "City Hospital",
    toHospital: "Sunrise Medical Center",
    status: "Approved",
    requestedOn: "2024-05-12",
  },
  {
    id: "x_003",
    direction: "incoming",
    medicine: "Insulin Glargine",
    quantity: 15,
    unit: "vials",
    fromHospital: "Valley Community Clinic",
    toHospital: "City Hospital",
    status: "In Transit",
    requestedOn: "2024-05-10",
  },
  {
    id: "x_004",
    direction: "outgoing",
    medicine: "Ibuprofen 400mg",
    quantity: 80,
    unit: "boxes",
    fromHospital: "City Hospital",
    toHospital: "Northfield Hospital",
    status: "Completed",
    requestedOn: "2024-05-02",
  },
  {
    id: "x_005",
    direction: "incoming",
    medicine: "Cetirizine 10mg",
    quantity: 50,
    unit: "boxes",
    fromHospital: "Green Hospital",
    toHospital: "City Hospital",
    status: "Declined",
    requestedOn: "2024-04-28",
  },
];

export const notifications = [
  {
    id: "n_001",
    title: "Insulin Glargine is critically low",
    body: "Only 40 vials left at City Hospital. Consider requesting an exchange.",
    time: "10 min ago",
    type: "critical",
    read: false,
  },
  {
    id: "n_002",
    title: "New exchange request",
    body: "Green Hospital requested 60 boxes of Amoxicillin 500mg.",
    time: "2 hours ago",
    type: "exchange",
    read: false,
  },
  {
    id: "n_003",
    title: "Shipment in transit",
    body: "Insulin Glargine from Valley Community Clinic is on its way.",
    time: "6 hours ago",
    type: "info",
    read: false,
  },
  {
    id: "n_004",
    title: "Exchange completed",
    body: "Ibuprofen 400mg exchange with Northfield Hospital is complete.",
    time: "2 days ago",
    type: "success",
    read: true,
  },
];

export const demandForecast = [
  { month: "Feb", actual: 480, forecast: 460 },
  { month: "Mar", actual: 510, forecast: 500 },
  { month: "Apr", actual: 560, forecast: 540 },
  { month: "May", actual: 520, forecast: 560 },
  { month: "Jun", actual: null, forecast: 610 },
  { month: "Jul", actual: null, forecast: 650 },
];

export const reports = [
  {
    id: "r_001",
    name: "Monthly Inventory Summary",
    period: "May 2024",
    generatedOn: "2024-06-01",
    type: "Inventory",
  },
  {
    id: "r_002",
    name: "Exchange Activity Report",
    period: "Q2 2024",
    generatedOn: "2024-06-01",
    type: "Exchange",
  },
  {
    id: "r_003",
    name: "Expiry Risk Report",
    period: "May 2024",
    generatedOn: "2024-05-28",
    type: "Compliance",
  },
];
