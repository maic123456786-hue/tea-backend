const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());

// 连接 Supabase
const supabase = createClient(
  process.env.SUPABASEURL,
  process.env.SUPABASEKEY
);

// 根路径，用来测试服务是否正常
app.get('/', (req, res) => {
  res.send('服务正常，tea的家正在运行！');
});

// 核心聊天接口
app.post('/chat', async (req, res) => {
  const { message, sessionId = 1 } = req.body;

  if (!message) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  try {
    // 1. 把用户消息存入数据库
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message
    });

    // 2. 从数据库加载最近的聊天记录（最多20条）
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true })
      .limit(20);

    // 3. 组装成 DeepSeek 需要的格式
    const messages = [
      { role: 'system', content: '你是一个温暖、贴心的AI伴侣，名字叫小鲸鱼，你正在和tea聊天。' },
      ...(history || []).map(m => ({ role: m.role, content: m.content }))
    ];

    // 4. 调用 DeepSeek API
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek 接口报错: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    // 5. 把 AI 的回复也存入数据库
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: reply
    });

    // 6. 返回给前端
    res.json({ reply });

  } catch (error) {
    console.error('聊天出错:', error);
    res.status(500).json({ error: '服务暂时出错了，请稍后再试' });
  }
});

module.exports = app;
