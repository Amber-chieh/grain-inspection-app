// 您的 Google Apps Script URL (這是您的數據入口)
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby5sWqYfA84OpnpZJJOJ4-UKhSBKZ6P4iCzlqIjW4ZoNsGmxt8I_3rBLlPuoA1BpQ7obQ/exec';

document.getElementById('inspectionForm').addEventListener('submit', function(event) {
    // 阻止表單的預設提交行為，改用 Fetch API 處理
    event.preventDefault(); 

    const form = event.target;
    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
        data[key] = value;
    });

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = '提交中...請稍候';

    // 使用 Fetch API 進行非同步提交 (解決 405 錯誤的關鍵)
    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: new URLSearchParams(data) 
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error('伺服器響應失敗，請檢查腳本部署和權限。');
        }
    })
    .then(result => {
        if (result && result.result === 'success') {
            alert('巡察報告提交成功！數據已寫入 Google 試算表。');
            form.reset();
        } else {
            throw new Error('Apps Script 執行錯誤: ' + (result ? result.error : '未知錯誤'));
        }
    })
    .catch(error => {
        console.error('提交錯誤:', error);
        alert('提交失敗！錯誤訊息：' + error.message + ' (請確認 Apps Script 權限)');
    })
    .finally(() => {
        submitButton.disabled = false;
        submitButton.textContent = '提交巡察報告';
    });
});