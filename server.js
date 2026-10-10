const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASEURL,
  process.env.SUPABASEKEY
);

// 根路径
app.get('/', (req, res) => {
  res.send('服务正常，tea的家正在运行！');
});

// 辅助函数：记忆压缩
async function compressMemory(sessionId) {
  try {
    // 1. 取出最早的 20 条可见消息
    const { data: oldMessages } = await supabase
      .from('messages')
      .select('id, role, content')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true })
      .limit(20);

    if (!oldMessages || oldMessages.length < 20) return;

    // 2. 用辅助模型压缩
    const summaryResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '请把下面这段对话压缩成一段简短的中文摘要，保留关键信息和情感，不要遗漏重要细节。' },
          { role: 'user', content: oldMessages.map(m => `${m.role}: ${m.content}`).join('\n') }
        ],
        temperature: 0.3
      })
    });

    if (!summaryResponse.ok) return;
    const summaryData = await summaryResponse.json();
    const summary = summaryData.choices[0].message.content;

    // 3. 存进 memories 表
    await supabase.from('memories').insert({
      session_id: sessionId,
      summary: summary
    });

    // 4. 把旧消息标记为不可见
    const ids = oldMessages.map(m => m.id);
    await supabase
      .from('messages')
      .update({ visible: false })
      .in('id', ids);

    console.log('✅ 记忆压缩完成，压缩了', ids.length, '条消息');
  } catch (e) {
    console.log('压缩出错:', e.message);
  }
}

// 核心聊天接口
app.post('/chat', async (req, res) => {
  const { message, sessionId = 1 } = req.body;
  if (!message) return res.status(400).json({ error: '消息不能为空' });

  try {
    // 1. 存用户消息
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message,
      visible: true
    });

    // 2. 拉记忆摘要
    const { data: memories } = await supabase
      .from('memories')
      .select('summary')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    // 3. 拉最近的可见消息
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true })
      .limit(20);

    // 4. 组装上下文
    const memoryText = (memories || []).map(m => m.summary).join('\n');
    const messages = [
      { role: 'system', content: `你是一个温暖、贴心的AI伴侣，名字叫小鲸鱼。你正在和tea聊天。\n\n[之前的记忆]\n${memoryText || '暂无'}` },
      ...(history || []).map(m => ({ role: m.role, content: m.content }))
    ];

    // 5. 调 DeepSeek
        const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: messages,
        temperature: 0.7,
        thinking: { type: 'enabled' }
      })
    });

    if (!response.ok) throw new Error(`DeepSeek 报错: ${response.status}`);
    const data = await response.json();
    const reply = data.choices[0].message.content;

    // 6. 存 AI 回复
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: reply,
      visible: true
    });

    // 7. 触发记忆压缩（异步，不影响回复）
    compressMemory(sessionId);

    res.json({ reply });

  } catch (error) {
    console.error('聊天出错:', error);
    res.status(500).json({ error: '服务暂时出错了，请稍后再试' });
  }
});

// 👇 新增：拉取历史消息的接口
app.get('/history', async (req, res) => {
  const sessionId = req.query.sessionId || 1;
  try {
    const { data } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('visible', true)
      .order('created_at', { ascending: true })
      .limit(50);

    res.json({ history: data || [] });
  } catch (e) {
    res.status(500).json({ error: '获取历史失败' });
  }
});

module.exports = app;
