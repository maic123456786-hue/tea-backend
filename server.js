const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// 健康检查接口
app.get('/', (req, res) => {
  res.send('服务正常，tea的家正在运行！');
});

app.listen(port, () => {
  console.log(`后端服务已启动，正在监听 ${port} 端口`);
});