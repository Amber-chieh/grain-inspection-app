// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, onSnapshot, collection, query, serverTimestamp, orderBy, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global Firebase Variables
let db;
let auth;
let currentUserId = null;
let appReady = false;

// Constants and UI Elements
// Global variables provided by the environment (MUST be used)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// UI Element References
const authStatusEl = document.getElementById('auth-status');
const userDisplayIdEl = document.getElementById('user-display-id');
const submitButton = document.getElementById('submit-button');
const inspectionsListEl = document.getElementById('inspections-list');
const loadingText = document.getElementById('loading-text');
const canvas = document.getElementById('signatureCanvas');

// --- Core Inspection Data Structure ---
const INSPECTION_ITEMS = [
    { area: "人員管制與行政區", items: [
        { id: "ctrl-office", name: "控制室/辦公大樓 (門窗、燈火檢查)", category: "A" },
        { id: "security-gate", name: "警衛室與週遭環境 (人車進出管制紀錄)", category: "A" }
    ]},
    { area: "碼頭區與裝卸作業", items: [
        { id: "op-status-details", name: "進/出倉作業細節 (人員、機具、物料是否正常)", category: "B" },
        { id: "unloader-access", name: "吸/卸穀機一樓樓梯門 (無作業時上鎖狀態)", category: "B" },
        { id: "rail-track", name: "移車軌道/周邊作業區管制", category: "B" },
        { id: "vessel-check", name: "異常船隻/人員/船邊纜繩/舷梯/防鼠盾 (若有靠船)", category: "B" }
    ]},
    { area: "廠區設施與安全", items: [
        { id: "road-surface", name: "廠區道路路面/地腳品回收區 (有無雜物、掉落物)", category: "C" },
        { id: "hv-drain", name: "高壓配電室/地磅磅槽/周邊水溝 (積水檢查)", category: "C" },
        { id: "fire-cctv", name: "消防受信總機系統/廠區監視系統", category: "C" }
    ]},
    { area: "機械塔與穀倉管制", items: [
        { id: "mech-tower-gate", name: "機械塔進出鐵門管制 (無作業時上鎖狀態)", category: "D" },
        { id: "silo-doors", name: "穀倉北側/南側邊門/倉底後側通道門", category: "D" },
        { id: "mech-spot-check", name: "機械塔檢點表 (抽檢樓層、電氣室)", category: "D" }
    ]},
    { area: "假日施工管理", items: [
        { id: "const-log", name: "廠區施工紀錄 (有無申請、地點、承商)", category: "E" },
        { id: "const-safety", name: "作業安全裝備 (是否依規定穿著/配戴)", category: "E" }
    ]}
];

// --- Signature Pad Logic ---
let ctx;
let drawing = false;

function initializeSignaturePad() {
    ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.scale(ratio, ratio);
        clearSignature();
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function getTouchPos(e) {
        const rect = canvas.getBoundingClientRect();
        // Adjust touch coordinates for display ratio
        return {
            x: (e.touches[0].clientX - rect.left) / (canvas.width / canvas.offsetWidth),
            y: (e.touches[0].clientY - rect.top) / (canvas.height / canvas.offsetHeight)
        };
    }

    function startDraw(e) {
        drawing = true;
        ctx.beginPath();
        const pos = e.type.includes('mouse') ? { x: e.offsetX, y: e.offsetY } : getTouchPos(e);
        ctx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
        if (!drawing) return;
        e.preventDefault(); // Prevent scrolling on touch
        const pos = e.type.includes('mouse') ? { x: e.offsetX, y: e.offsetY } : getTouchPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    }

    function endDraw() {
        drawing = false;
        ctx.closePath();
    }

    // Setup context styles
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    // Attach event listeners
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseout', endDraw);
    canvas.addEventListener('touchstart', (e) => startDraw(e.touches[0]));
    canvas.addEventListener('touchmove', (e) => draw(e.touches[0]));
    canvas.addEventListener('touchend', endDraw);

    // Expose utility functions to the global window object for HTML onclick
    window.getSignatureDataURL = () => canvas.toDataURL('image/png');
    window.clearSignature = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    };
}


// --- Inspection Item Generation ---
function generateChecklistHTML() {
    const container = document.getElementById('checklist-container');
    if (!container) return; // Safety check
    container.innerHTML = ''; 

    INSPECTION_ITEMS.forEach(section => {
        let sectionHtml = `<div class="p-4 bg-gray-50 rounded-lg border-l-4 border-secondary-green">
            <h3 class="text-lg font-semibold text-gray-800 mb-3">${section.area}</h3>
            <div class="space-y-3">`;

        section.items.forEach(item => {
            const statusName = `status-${item.id}`;
            const remarkId = `remark-${item.id}`;
            const timeId = `time-${item.id}`;
            
            sectionHtml += `
                <div class="p-3 bg-white rounded-md border border-gray-200">
                    <label class="block text-sm font-medium text-gray-800 mb-2">${item.name}</label>
                    <div class="flex flex-wrap items-center gap-4 mb-2">
                        <!-- Status Radios -->
                        <div class="flex items-center space-x-3">
                            <label class="flex items-center text-sm">
                                <input type="radio" name="${statusName}" value="Normal" class="h-4 w-4 text-secondary-green border-gray-300" checked>
                                <span class="ml-1 text-green-600 font-medium">正常</span>
                            </label>
                            <label class="flex items-center text-sm">
                                <input type="radio" name="${statusName}" value="Abnormal" class="h-4 w-4 text-abnormal-red border-gray-300">
                                <span class="ml-1 text-abnormal-red font-medium">異常</span>
                            </label>
                        </div>
                        <!-- Time Input -->
                        <input type="time" id="${timeId}" class="p-1 border border-gray-300 rounded-md text-sm" value="${new Date().toTimeString().substring(0, 5)}">
                    </div>
                    <!-- Remark Textarea -->
                    <textarea id="${remarkId}" rows="1" class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-primary-blue focus:border-primary-blue mt-1" placeholder="說明/備註 (異常時請詳述處置對策)"></textarea>
                </div>
            `;
        });

        sectionHtml += `</div></div>`;
        container.innerHTML += sectionHtml;
    });
}

// --- Data Submission (Exposed to window for HTML onclick) ---
window.submitInspection = async function() {
    if (!appReady || !currentUserId) {
        console.error('App not ready or user not logged in.');
        alert('應用程式尚未準備就緒或未登入，請稍候再試。');
        return;
    }

    const inspectionType = document.getElementById('inspection-type').value;
    const siloSelection = document.getElementById('select-silo').value;
    const operationStatus = document.getElementById('operation-status').value;
    const inspectionDate = document.getElementById('inspection-date').value;
    const generalNotes = document.getElementById('general-notes').value.trim();
    const signatureDataURL = window.getSignatureDataURL();

    if (!siloSelection || !inspectionDate) {
        alert('請填寫巡察地點/穀倉編號和巡察日期/時間！');
        return;
    }

    // Check if the canvas is blank 
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    if (signatureDataURL === tempCanvas.toDataURL('image/png')) {
        alert('請先進行電子簽名！');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = '提交中...';

    const [location, siloId] = siloSelection.split('#');
    const checkItems = [];

    // Gather all checklist data
    INSPECTION_ITEMS.forEach(section => {
        section.items.forEach(item => {
            const statusEl = document.querySelector(`input[name="status-${item.id}"]:checked`);
            const timeEl = document.getElementById(`time-${item.id}`);
            const remarkEl = document.getElementById(`remark-${item.id}`);
            
            checkItems.push({
                area: section.area,
                item: item.name,
                status: statusEl ? statusEl.value : 'NA',
                time: timeEl ? timeEl.value : '',
                remark: remarkEl ? remarkEl.value.trim() : '',
            });
        });
    });

    const inspectionData = {
        inspectionType: inspectionType,
        location: location,
        siloId: `#${siloId}`,
        operationStatus: operationStatus,
        inspectionDate: inspectionDate,
        inspectorId: currentUserId,
        inspectorName: `User-${currentUserId.substring(0, 8)}`, // Mock name
        submissionTimestamp: serverTimestamp(),
        generalNotes: generalNotes,
        inspectorSignature: signatureDataURL,
        checkItems: checkItems,
        approvalStatus: 'Pending',
        approverId: null,
        approvalTimestamp: null,
    };

    try {
        // Public data path for shared inspection records
        const inspectionsRef = collection(db, `artifacts/${appId}/public/data/inspections`);
        await addDoc(inspectionsRef, inspectionData);
        
        // Success feedback and reset
        alert('巡察紀錄提交成功！');
        
        // Reset form fields
        document.getElementById('inspection-type').value = "General"; 
        document.getElementById('select-silo').value = "";
        document.getElementById('operation-status').value = "None";
        
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('inspection-date').value = now.toISOString().slice(0, 16);
        
        document.getElementById('general-notes').value = '';
        window.clearSignature();
        generateChecklistHTML(); // Re-render to reset radio/textarea defaults
        
    } catch (error) {
        console.error("Error submitting document: ", error);
        alert('提交失敗: ' + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = '提交巡察紀錄';
    }
}

// --- Approval/Rejection Function (Exposed to window for HTML onclick) ---
window.handleApproval = async function(docId, status) {
    if (!appReady || !currentUserId) {
        alert('應用程式尚未準備就緒或未登入。');
        return;
    }

    if (currentUserId.includes('User-')) {
        console.warn('警告：您目前是匿名用戶。在實際環境中，只有具備管理權限的用戶才能執行審核。');
    }

    // Using browser's confirmation dialog (Note: this is usually restricted in iframes)
    if (!confirm(`確定要將此紀錄設為 ${status === 'Approved' ? '通過' : '駁回'} 嗎？`)) { 
        return;
    }

    const docRef = doc(db, `artifacts/${appId}/public/data/inspections`, docId);
    try {
        await updateDoc(docRef, {
            approvalStatus: status,
            approverId: currentUserId,
            approverName: `Manager-${currentUserId.substring(0, 8)}`, // Mock manager name
            approvalTimestamp: serverTimestamp(),
        });
        alert('審核狀態更新成功！');
    } catch (error) {
        console.error("Error updating approval status: ", error);
        alert('審核更新失敗: ' + error.message);
    }
}

// --- Data Export to CSV Function (Exposed to window for HTML onclick) ---
window.exportToCSV = async function() {
    if (!db || !appReady) {
        alert('應用程式尚未準備就緒。');
        return;
    }

    const exportButton = document.getElementById('export-button');
    exportButton.disabled = true;
    const originalText = exportButton.textContent;
    exportButton.textContent = '匯出中...';

    try {
        const inspectionsRef = collection(db, `artifacts/${appId}/public/data/inspections`);
        const snapshot = await getDocs(inspectionsRef);

        if (snapshot.empty) {
            alert('沒有可匯出的紀錄。');
            return;
        }

        let csv = "";
        // Define static headers
        let headers = [
            "ID", "巡察地點", "穀倉編號", "巡察類型", "作業狀態", "巡察日期時間", 
            "巡察人ID", "巡察人姓名", "提交時間", "審核狀態", "審核人ID", "審核人姓名", "總結與處置"
        ];

        // Dynamically build checklist headers
        const checklistHeaders = [];
        INSPECTION_ITEMS.forEach(section => {
            section.items.forEach(item => {
                // Ensure headers match the data structure (Status, Time, Remark)
                checklistHeaders.push(`${item.name} - 狀態`);
                checklistHeaders.push(`${item.name} - 時間`);
                checklistHeaders.push(`${item.name} - 備註`);
            });
        });
        
        csv += headers.join(',') + ',' + checklistHeaders.join(',') + "\n";

        // Simple escape function for CSV (handles quotes, commas, and newlines)
        const escape = (str) => {
            if (str === null || str === undefined) return "";
            // Replace line breaks with spaces for single cell display in CSV
            str = String(str).replace(/\r?\n|\r/g, ' '); 
            str = String(str).replace(/"/g, '""'); // Escape double quotes
            if (str.includes(',') || str.includes('"')) {
                return `"${str}"`; // Enclose in quotes if necessary
            }
            return str;
        };

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            
            const submissionTime = data.submissionTimestamp ? new Date(data.submissionTimestamp.toDate()).toLocaleString() : 'N/A';
            
            // Core data row
            let row = [
                escape(doc.id),
                escape(data.location),
                escape(data.siloId),
                escape(data.inspectionType === 'LongHoliday' ? '連續假日巡察' : '一般假日巡察'),
                escape(data.operationStatus === 'None' ? '無作業' : data.operationStatus === 'Inbound' ? '進倉作業中' : data.operationStatus === 'Outbound' ? '出倉作業中' : 'N/A'),
                escape(data.inspectionDate.replace('T', ' ')),
                escape(data.inspectorId),
                escape(data.inspectorName),
                escape(submissionTime),
                escape(data.approvalStatus === 'Approved' ? '已通過' : data.approvalStatus === 'Rejected' ? '已駁回' : '待審核'),
                escape(data.approverId || ''), 
                escape(data.approverName || ''), 
                escape(data.generalNotes),
            ];
            
            // Checklist data row
            const checklistData = [];
            INSPECTION_ITEMS.forEach(section => {
                section.items.forEach(item => {
                    const foundItem = data.checkItems.find(check => check.item === item.name);
                    if (foundItem) {
                        // Match the status, time, and remark structure
                        checklistData.push(escape(foundItem.status === 'Normal' ? '正常' : foundItem.status === 'Abnormal' ? '異常' : 'N/A'));
                        checklistData.push(escape(foundItem.time));
                        checklistData.push(escape(foundItem.remark));
                    } else {
                        // Placeholder for missing data
                        checklistData.push("", "", "");
                    }
                });
            });

            csv += row.join(',') + ',' + checklistData.join(',') + "\n";
        });
        
        // Create Blob and trigger download (Adding BOM for Chinese character support in Excel/Sheets)
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' }); 
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        const now = new Date().toISOString().slice(0, 10);
        a.setAttribute('download', `GrainInspection_Report_${now}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // alert('巡察紀錄已成功匯出為 CSV 檔案！請將此檔案匯入 Google 試算表。');

    } catch (error) {
        console.error("Error exporting to CSV: ", error);
        alert('匯出 CSV 失敗: ' + error.message);
    } finally {
        exportButton.disabled = false;
        exportButton.textContent = originalText;
    }
}

// --- Data Display (Real-Time Listener Render Function) ---
function renderInspection(doc) {
    const data = doc.data();
    const docId = doc.id;
    const isAbnormal = data.checkItems.some(item => item.status === 'Abnormal');
    const approvalColor = data.approvalStatus === 'Approved' ? 'bg-secondary-green' : data.approvalStatus === 'Rejected' ? 'bg-abnormal-red' : 'bg-yellow-500';
    const approvalText = data.approvalStatus === 'Approved' ? '已通過' : data.approvalStatus === 'Rejected' ? '已駁回' : '待審核';
    const inspectionTypeText = data.inspectionType === 'LongHoliday' ? '連續假日' : '一般假日'; 

    // Function to handle approval confirmation (using confirm dialog)
    const confirmApproval = (status) => {
        if (confirm(`確定要將此紀錄設為 ${status === 'Approved' ? '通過' : '駁回'} 嗎？`)) {
            window.handleApproval(docId, status); // Call global function
        }
    };
    
    // Approval buttons (inline JavaScript needs to reference the global window functions)
    const approvalActions = (data.approvalStatus === 'Pending') && currentUserId ? `
        <button onclick="window.handleApproval('${docId}', 'Approved')" class="bg-secondary-green hover:bg-green-700 text-white text-xs font-bold py-1 px-3 rounded-md transition duration-150">通過</button>
        <button onclick="window.handleApproval('${docId}', 'Rejected')" class="bg-abnormal-red hover:bg-red-700 text-white text-xs font-bold py-1 px-3 rounded-md transition duration-150">駁回</button>
    ` : '';
    
    // Build detailed checklist table
    let detailHtml = data.checkItems.map(item => `
        <tr class="border-t">
            <td class="p-2 text-sm text-gray-700">${item.item}</td>
            <td class="p-2 text-sm font-medium ${item.status === 'Abnormal' ? 'text-abnormal-red' : 'text-gray-700'}">
                ${item.status === 'Normal' ? '正常' : item.status === 'Abnormal' ? '異常' : 'N/A'}
            </td>
            <td class="p-2 text-sm text-gray-600">${item.time || 'N/A'}</td>
            <td class="p-2 text-sm text-gray-600 break-words">${item.remark || '-'}</td>
        </tr>
    `).join('');

    const html = `
        <div class="p-4 bg-white rounded-xl card border-l-8 ${isAbnormal ? 'border-abnormal-red' : 'border-primary-blue'}">
            <div class="flex justify-between items-start mb-3 border-b pb-3">
                <div>
                    <span class="text-xl font-bold text-primary-blue">${data.location} ${data.siloId} 巡察</span>
                    <span class="ml-3 text-sm font-medium px-2 py-1 rounded-full text-white ${approvalColor}">${approvalText}</span>
                </div>
                <div class="text-right">
                    <p class="text-sm font-semibold">${data.inspectionDate.replace('T', ' ')}</p>
                    <p class="text-xs text-gray-500">巡察人: ${data.inspectorName}</p>
                </div>
            </div>
            
            <div class="space-y-3">
                <div class="flex justify-between text-sm">
                    <p class="font-medium text-gray-700">巡察類型: <span class="text-gray-900">${inspectionTypeText}</span></p>
                    <p class="font-medium text-gray-700">作業狀態: <span class="text-gray-900">${data.operationStatus === 'None' ? '無作業' : data.operationStatus === 'Inbound' ? '進倉' : data.operationStatus === 'Outbound' ? '出倉' : 'N/A'}</span></p>
                    <p class="font-medium text-gray-700">提交時間: <span class="text-gray-900">${data.submissionTimestamp ? new Date(data.submissionTimestamp.toDate()).toLocaleString() : 'N/A'}</span></p>
                </div>

                <div class="bg-gray-50 p-3 rounded-lg">
                    <h4 class="font-semibold mb-1">總結與處置：</h4>
                    <p class="text-sm text-gray-800 whitespace-pre-wrap">${data.generalNotes || '無總結說明。'}</p>
                </div>

                <details class="cursor-pointer">
                    <summary class="font-bold text-primary-blue hover:text-blue-700">查看詳細巡察清單 (點擊展開)</summary>
                    <div class="mt-3 overflow-x-auto">
                        <table class="min-w-full bg-white border border-gray-200 rounded-lg">
                            <thead>
                                <tr class="bg-gray-100 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                                    <th class="p-2">巡查節點</th>
                                    <th class="p-2">狀態</th>
                                    <th class="p-2">時間</th>
                                    <th class="p-2">備註/說明</th>
                                </tr>
                            </thead>
                            <tbody>${detailHtml}</tbody>
                        </table>
                    </div>
                    
                    <div class="mt-4 border-t pt-3">
                        <h4 class="font-semibold mb-1">巡察人簽名:</h4>
                        <img src="${data.inspectorSignature}" alt="Inspector Signature" class="border p-1 bg-white rounded-md max-w-full h-auto" style="max-height: 100px;">
                        ${data.approverId ? `<p class="text-sm mt-2 text-gray-600">審核人: ${data.approverName} (${data.approvalTimestamp ? new Date(data.approvalTimestamp.toDate()).toLocaleString() : 'N/A'})</p>` : ''}
                    </div>
                </details>
            </div>

            <div class="mt-4 flex justify-end space-x-2">
                ${approvalActions}
            </div>
        </div>
    `;
    return html;
}

function setupInspectionListener() {
    if (!db || !appReady) return;

    const inspectionsRef = collection(db, `artifacts/${appId}/public/data/inspections`);
    // Query: Order by submission time descending
    const q = query(inspectionsRef, orderBy("submissionTimestamp", "desc"));

    onSnapshot(q, (snapshot) => {
        loadingText.style.display = 'none';
        inspectionsListEl.innerHTML = '';
        if (snapshot.empty) {
            inspectionsListEl.innerHTML = '<p class="text-center text-gray-500 p-4 bg-white rounded-xl shadow">目前沒有任何巡察紀錄。</p>';
        }

        snapshot.docs.forEach(doc => {
            const docEl = document.createElement('div');
            docEl.innerHTML = renderInspection(doc);
            inspectionsListEl.appendChild(docEl.firstChild);
        });
    }, (error) => {
        console.error("Error listening to inspections: ", error);
        loadingText.textContent = `載入錯誤: ${error.message}`;
    });
}

// --- Initialization ---
async function initializeAppAndAuth() {
    if (!firebaseConfig.apiKey) {
        console.error("Firebase config is missing. Proceeding with mock setup.");
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        // setLogLevel('debug'); // Uncomment for Firestore debugging

        let signInSuccess = false;
        if (initialAuthToken) {
            try {
                await signInWithCustomToken(auth, initialAuthToken);
                signInSuccess = true;
            } catch (e) {
                console.warn("Custom token sign-in failed, falling back to anonymous:", e);
            }
        }
        
        if (!signInSuccess) {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            const exportButton = document.getElementById('export-button');

            if (user) {
                currentUserId = user.uid;
                appReady = true;

                userDisplayIdEl.textContent = currentUserId;
                authStatusEl.textContent = '已登入';
                authStatusEl.className = 'px-2 py-1 text-xs font-medium rounded-full bg-secondary-green text-green-800';
                submitButton.disabled = false;
                if (exportButton) {
                    exportButton.disabled = false; // Enable export button
                }

                // Start real-time listeners only after authentication is confirmed
                setupInspectionListener();
            } else {
                currentUserId = null;
                appReady = false;
                userDisplayIdEl.textContent = '未登入';
                authStatusEl.textContent = '登入失敗';
                authStatusEl.className = 'px-2 py-1 text-xs font-medium rounded-full bg-abnormal-red text-red-800';
                submitButton.disabled = true;
                if (exportButton) {
                    exportButton.disabled = true; // Disable export button
                }
                loadingText.textContent = '等待登入...';
            }
        });
    } catch (error) {
        console.error("Firebase Auth or Initialization Error:", error);
        authStatusEl.textContent = `登入錯誤: ${error.code}`;
        authStatusEl.className = 'px-2 py-1 text-xs font-medium rounded-full bg-abnormal-red text-red-800';
    }
}

// --- Main Entry Point ---
window.addEventListener('load', function() {
    // 1. Set default inspection date/time
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const inspectionDateEl = document.getElementById('inspection-date');
    if (inspectionDateEl) {
        inspectionDateEl.value = now.toISOString().slice(0, 16);
    }
    
    // 2. Initialize UI components
    initializeSignaturePad();
    generateChecklistHTML();
    
    // 3. Initialize Firebase and Auth
    initializeAppAndAuth();
});