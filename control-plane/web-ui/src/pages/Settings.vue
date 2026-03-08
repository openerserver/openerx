<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">设置</a-typography-title>

    <a-row :gutter="[16, 16]">
      <!-- Project Settings -->
      <a-col :xs="24" :md="12">
        <a-card title="项目设置">
          <a-form layout="vertical">
            <a-form-item label="默认模型">
              <a-select default-value="claude-sonnet-4-20250514" style="width: 100%">
                <a-select-option value="claude-sonnet-4-20250514">
                  Claude Sonnet 4 (Primary)
                </a-select-option>
                <a-select-option value="gpt-4.1-mini">
                  GPT-4.1 Mini (Fast)
                </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="最大并发数">
              <a-input-number :default-value="5" :min="1" :max="20" style="width: 100%" />
            </a-form-item>
            <a-form-item label="月度预算 ($)">
              <a-input-number :default-value="500" :min="0" :step="50" style="width: 100%" />
            </a-form-item>
          </a-form>
        </a-card>
      </a-col>

      <!-- Security Settings -->
      <a-col :xs="24" :md="12">
        <a-card title="安全设置">
          <a-space direction="vertical" style="width: 100%" :size="16">
            <a-flex justify="space-between" align="center">
              <span>生产环境操作需要审批</span>
              <a-switch :default-checked="true" />
            </a-flex>
            <a-flex justify="space-between" align="center">
              <span>Level 3 命令需要审批</span>
              <a-switch :default-checked="true" />
            </a-flex>
            <a-flex justify="space-between" align="center">
              <span>批量编辑需要审批 (&gt;10 文件)</span>
              <a-switch :default-checked="true" />
            </a-flex>
            <a-flex justify="space-between" align="center">
              <span>外部 API 调用需要审批</span>
              <a-switch />
            </a-flex>
          </a-space>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>
