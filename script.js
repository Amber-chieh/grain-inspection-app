// 您的 Google Apps Script URL (這是您的數據入口)
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby5sWqYfA84OpnpZJJOJ4-UKhSBKZ6P4iCzlqIjW4ZoNsGmxt8I_3rBLlPuoA1BpQ7obQ/exec";

// 根據選擇的穀倉編號更新標籤（全局函數，可在任何地方調用）
function updateBinLabel() {
  const binNumber = document.getElementById("binNumber");
  const binStatusLabel = document.getElementById("binStatusLabel");

  if (binNumber && binStatusLabel) {
    const selectedBin = binNumber.value;
    binStatusLabel.textContent = `#${selectedBin} 號穀倉 作業狀態：`;
  }
}

// 設置巡察日期預設為當日
document.addEventListener("DOMContentLoaded", function () {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const todayString = `${year}-${month}-${day}`;

  const dateInput = document.getElementById("inspectionDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = todayString;
  }

  // 監聽穀倉編號選擇變化
  const binNumber = document.getElementById("binNumber");

  if (binNumber) {
    binNumber.addEventListener("change", updateBinLabel);
  }

  // 初始化標籤
  updateBinLabel();
});

document
  .getElementById("inspectionForm")
  .addEventListener("submit", function (event) {
    // 阻止表單的預設提交行為，改用 Fetch API 處理
    event.preventDefault();

    const form = event.target;
    const formData = new FormData(form);
    const data = {};

    // 獲取選擇的穀倉編號
    const binNumber = formData.get("穀倉編號");
    
    // 獲取所有選中的穀倉作業狀態（支持多選）
    const binStatusArray = formData.getAll("穀倉作業狀態");
    const binStatus = binStatusArray.join("、"); // 用頓號連接多個選項

    // 遍歷所有表單欄位
    formData.forEach((value, key) => {
      // 跳過原始的「穀倉作業狀態」欄位，我們會用動態欄位名替代
      if (key !== "穀倉作業狀態") {
        data[key] = value;
      }
    });

    // 根據選擇的穀倉編號動態生成欄位名稱（例如：71號穀倉作業狀態）
    if (binNumber && binStatus) {
      data[`${binNumber}號穀倉作業狀態`] = binStatus;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "提交中...請稍候";

    // 使用 Fetch API 進行非同步提交 (解決 405 錯誤的關鍵)
    fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      body: new URLSearchParams(data),
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          throw new Error("伺服器響應失敗，請檢查腳本部署和權限。");
        }
      })
      .then((result) => {
        if (result && result.result === "success") {
          // 獲取選擇的穀倉編號
          const selectedBin = formData.get("穀倉編號") || "未知";
          alert(
            `#${selectedBin} 號穀倉巡察報告已提交成功，辛苦了！`
          );
          form.reset();
          // 重置日期為當日
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, "0");
          const day = String(today.getDate()).padStart(2, "0");
          const todayString = `${year}-${month}-${day}`;
          const dateInput = document.getElementById("inspectionDate");
          if (dateInput) {
            dateInput.value = todayString;
          }
          // 重置穀倉編號選擇為 71
          const binNumber = document.getElementById("binNumber");
          if (binNumber) {
            binNumber.value = "71";
            updateBinLabel();
          }
        } else {
          throw new Error(
            "Apps Script 執行錯誤: " + (result ? result.error : "未知錯誤")
          );
        }
      })
      .catch((error) => {
        console.error("提交錯誤:", error);
        alert(
          "提交失敗！錯誤訊息：" + error.message + " (請確認 Apps Script 權限)"
        );
      })
      .finally(() => {
        submitButton.disabled = false;
        submitButton.textContent = "提交巡察報告";
      });
  });
