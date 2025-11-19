let count = 0;

function increaseCount() {
    count++;
    document.getElementById('counter').innerText = '計數：' + count;
    console.log('計數已增加到: ' + count);
}