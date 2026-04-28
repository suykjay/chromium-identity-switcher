// Identity Switcher — options page

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

document.getElementById('btn-clear-all').onclick = async () => {
  if (!confirm('确定要清除所有身份数据吗？此操作不可撤销。')) return;
  const res = await chrome.runtime.sendMessage({ type: 'clearAllData' });
  if (res?.ok) {
    alert('所有数据已清除。');
  } else {
    alert('清除失败：' + (res?.error || '未知错误'));
  }
};
